const MAX_TRUSTED_PROXY_HOPS = 10;

const getTrustedProxyHops = (value = '0') => {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  }

  const hops = Number(value);
  if (hops > MAX_TRUSTED_PROXY_HOPS) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  }

  return hops;
};

module.exports = { getTrustedProxyHops };
