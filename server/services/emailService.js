const nodemailer = require('nodemailer');

const redactSmtpResponse = (value) => {
  let response = String(value || '');
  const sensitiveValues = [
    process.env.SMTP_HOST,
    process.env.SMTP_PASS,
    process.env.SMTP_USER,
    process.env.SMTP_FROM,
  ].filter(Boolean);

  for (const secret of sensitiveValues) {
    response = response.split(secret).join('[redacted]');
  }

  return response
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/https?:\/\/\S+/gi, '[URL redacted]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[token redacted]')
    .replace(/\b(password|pass|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\b(?:smtp|smtps):\/\/\S+/gi, '[SMTP URL redacted]')
    .replace(/\b[A-Za-z0-9+/]{24,}={0,2}\b/g, '[encoded credential redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
};

const getConfigurationIssues = (env = process.env) => {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS'];
  const issues = required.filter((key) => !env[key]);
  const port = Number(env.SMTP_PORT);
  const portValid = Number.isInteger(port) && port > 0 && port <= 65535;

  if (env.SMTP_PORT && !portValid) issues.push('SMTP_PORT_INVALID');
  if (env.SMTP_SECURE && !['true', 'false'].includes(env.SMTP_SECURE.toLowerCase())) {
    issues.push('SMTP_SECURE_INVALID');
  }
  if (portValid && port === 465 && env.SMTP_SECURE?.toLowerCase() !== 'true') {
    issues.push('SMTP_SECURE_MUST_BE_TRUE_FOR_PORT_465');
  }
  if (portValid && port === 587 && env.SMTP_SECURE?.toLowerCase() === 'true') {
    issues.push('SMTP_SECURE_MUST_BE_FALSE_FOR_PORT_587');
  }

  return issues;
};

const classifySmtpError = (error) => {
  const code = String(error?.code || '').toUpperCase();
  const command = String(error?.command || '').toUpperCase();
  const responseCode = Number(error?.responseCode);
  const message = String(error?.message || '').toLowerCase();
  const evidence = `${code} ${command} ${message}`;

  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ESERVFAIL'].includes(code) || /getaddrinfo|dns lookup/.test(message)) {
    return 'DNS_RESOLUTION';
  }
  if (code === 'ETIMEDOUT' || /timed?\s*out|timeout/.test(message)) {
    return 'CONNECTION_TIMEOUT';
  }
  if (
    code.startsWith('ERR_TLS') ||
    code.startsWith('CERT_') ||
    code === 'EPROTO' ||
    command === 'STARTTLS' ||
    /tls|ssl|certificate|wrong version number/.test(evidence)
  ) {
    return 'TLS';
  }
  if (code === 'EAUTH' || command === 'AUTH' || responseCode === 535 || /authentication|auth failed|invalid login/.test(message)) {
    return 'AUTHENTICATION';
  }
  if (['ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return 'CONNECTION';
  }
  if (responseCode >= 400 && responseCode <= 599) {
    return 'SMTP_SERVER_RESPONSE';
  }
  return 'UNKNOWN';
};

const getSafeSmtpErrorDetails = (error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_-]{1,64}$/i.test(error.code)
    ? error.code
    : 'UNKNOWN';
  const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : undefined;
  const command = typeof error?.command === 'string' && /^[A-Z0-9_-]{1,32}$/i.test(error.command)
    ? error.command
    : '';
  const name = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name)
    ? error.name
    : 'Error';
  return {
    category: classifySmtpError(error),
    name,
    code,
    command,
    message: redactSmtpResponse(error?.message),
    ...(responseCode ? { responseCode } : {}),
    response: redactSmtpResponse(error?.response),
  };
};

const createSmtpError = (phase, error) => {
  const safeDetails = getSafeSmtpErrorDetails(error);
  const smtpError = new Error(`SMTP ${phase} failed (${safeDetails.category})`);
  smtpError.smtpPhase = phase;
  smtpError.smtpDiagnostics = safeDetails;
  return smtpError;
};

const getConfigurationStatus = (env = process.env) => {
  const issues = getConfigurationIssues(env);
  return { configured: issues.length === 0, issues };
};

const isConfigured = () => {
  return getConfigurationStatus().configured;
};

const sendPasswordResetEmail = async (email, token) => {
  const configuration = getConfigurationStatus();
  if (!configuration.configured) {
    const error = new Error('SMTP configuration is incomplete.');
    error.smtpPhase = 'configuration';
    error.smtpDiagnostics = {
      category: 'MISSING_CONFIGURATION',
      name: 'ConfigurationError',
      code: 'CONFIGURATION',
      command: '',
      message: `Missing or invalid settings: ${configuration.issues.join(', ')}`,
      response: '',
    };
    throw error;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : {}),
  });
  const resetUrl = new URL('/reset-password', process.env.CLIENT_URL || 'http://localhost:3000');
  resetUrl.searchParams.set('token', token);
  let phase = 'verify';

  try {
    await transporter.verify();
    phase = 'send';
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: 'Reset your JobTrack password',
      text: `Use this link to reset your JobTrack password. It expires in 1 hour:\n\n${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Use the link below to reset your JobTrack password. It expires in 1 hour.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    });
  } catch (error) {
    throw createSmtpError(phase, error);
  } finally {
    transporter.close();
  }
};

module.exports = {
  isConfigured,
  sendPasswordResetEmail,
  getSafeSmtpErrorDetails,
  getConfigurationStatus,
  classifySmtpError,
};
