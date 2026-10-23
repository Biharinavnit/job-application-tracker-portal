import React, { useEffect, useRef, useState } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

const formatFileSize = (size) => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export default function AttachedDocumentsModal({ application, onClose, onDocumentsChanged }) {
  const { user } = useAuth();
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const previewTimer = useRef(null);
  const previewRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setAttachments([]);
    api.get(`/applications/${application._id}/attachments`)
      .then(({ data }) => {
        if (!cancelled) setAttachments(data.data);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError.response?.data?.message || 'Unable to load attached documents.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [application._id]);

  const openPdf = async (attachment) => {
    const requestId = ++previewRequest.current;
    window.clearTimeout(previewTimer.current);
    setPreview({ attachment, status: 'loading', src: '' });
    const viewUrl = `/api/applications/${application._id}/attachments/${attachment._id}/view`;
    try {
      const { data: session } = await api.post(
        `/applications/${application._id}/attachments/${attachment._id}/preview-session`,
        {},
        { withCredentials: true }
      );
      if (requestId !== previewRequest.current) return;
      if (session.url !== viewUrl) {
        throw new Error('The preview session returned an unexpected document URL.');
      }

      const response = await api.get(viewUrl, {
        headers: { Range: 'bytes=0-0' },
        responseType: 'blob',
        withCredentials: true,
      });
      if (requestId !== previewRequest.current) return;
      const contentType = response.headers?.['content-type']?.split(';')[0].trim().toLowerCase();
      if (response.status !== 206 || contentType !== 'application/pdf') {
        throw new Error('The preview endpoint did not return a PDF. Try again or download the document.');
      }

      setPreview({ attachment, status: 'loading', src: viewUrl });
      previewTimer.current = window.setTimeout(() => {
        setPreview((current) => current?.attachment._id === attachment._id &&
          current.status === 'loading'
          ? { ...current, status: 'error' }
          : current);
      }, 30000);
    } catch (requestError) {
      if (requestId !== previewRequest.current) return;
      setPreview({
        attachment,
        status: 'error',
        src: '',
        message: requestError.response?.status === 401
          ? `Your session cannot preview ${attachment.originalName}. Sign in again and retry.`
          : requestError.response?.status === 403
            ? `You do not have permission to preview ${attachment.originalName}.`
            : requestError.response?.status === 404
              ? `${attachment.originalName} is no longer available.`
              : requestError.message ||
                requestError.response?.data?.message ||
                `Unable to open ${attachment.originalName}. Try again or download the document.`,
      });
    }
  };

  const closePdfPreview = () => {
    const attachment = preview?.attachment;
    ++previewRequest.current;
    window.clearTimeout(previewTimer.current);
    setPreview(null);
    if (attachment) {
      api.delete(`/applications/${application._id}/attachments/${attachment._id}/preview-session`)
        .catch(() => {});
    }
  };

  useEffect(() => () => {
    window.clearTimeout(previewTimer.current);
    const attachment = preview?.attachment;
    if (attachment) {
      api.delete(`/applications/${application._id}/attachments/${attachment._id}/preview-session`)
        .catch(() => {});
    }
  }, [application._id, preview?.attachment]);

  useEffect(() => {
    if (!preview?.src) return undefined;
    const attachmentId = preview.attachment._id;
    const interval = window.setInterval(async () => {
      try {
        await api.post(`/applications/${application._id}/attachments/${attachmentId}/preview-session`);
      } catch {
        setPreview((current) => current?.attachment._id === attachmentId
          ? {
            ...current,
            status: 'error',
            message: 'The PDF preview session could not be renewed. Retry the preview to continue.',
          }
          : current);
      }
    }, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [application._id, preview?.attachment._id, preview?.src]);

  const downloadAttachment = async (attachment) => {
    setError('');
    try {
      const { data } = await api.get(
        `/applications/${application._id}/attachments/${attachment._id}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.originalName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(`Unable to download ${attachment.originalName}. The document may no longer be available.`);
    }
  };

  const deleteAttachment = async (attachment) => {
    if (!window.confirm(`Move ${attachment.originalName} to Recently Deleted?`)) return;
    setDeletingId(attachment._id);
    setError('');
    try {
      await api.delete(`/applications/${application._id}/attachments/${attachment._id}`);
      setAttachments((current) => current.filter((item) => item._id !== attachment._id));
      onDocumentsChanged?.();
      toast.success('Document moved to Recently Deleted');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to move document to Recently Deleted.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="modal attached-documents-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attached-documents-title"
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="attached-documents-title">Attached Documents</h2>
            <div className="attached-documents-company">{application.company} · {application.role}</div>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close attached documents">✕</button>
        </div>
        <div className="attached-documents-body" aria-live="polite">
          {loading ? (
            <div className="notes-empty">Loading attached documents…</div>
          ) : error && attachments.length === 0 ? (
            <div className="error-msg" role="alert">{error}</div>
          ) : attachments.length === 0 ? (
            <div className="attached-documents-empty">
              <div className="attached-documents-empty-icon">📄</div>
              <strong>No documents attached</strong>
              <span>Import a PDF or DOCX from the application editor.</span>
            </div>
          ) : (
            <>
              {error && <div className="error-msg attached-documents-error" role="alert">{error}</div>}
              <ul className="attached-documents-list">
                {attachments.map((attachment) => (
                  <li className="attached-document-row" key={attachment._id}>
                    <div className="attached-document-info">
                      <strong>{attachment.originalName}</strong>
                      <span>{attachment.documentType.toUpperCase()} · {formatFileSize(attachment.size)}</span>
                    </div>
                    <div className="attached-document-actions">
                      {attachment.documentType === 'pdf' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openPdf(attachment)}
                        >
                          View PDF
                        </button>
                      )}
                      {attachment.documentType === 'docx' && (
                        <span className="attached-document-preview-note">DOCX preview isn’t supported</span>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => downloadAttachment(attachment)}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => deleteAttachment(attachment)}
                        disabled={deletingId === attachment._id || user?.isDemo}
                        title={user?.isDemo ? 'Documents cannot be changed in the read-only demo' : undefined}
                      >
                        {deletingId === attachment._id ? 'Moving…' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      {preview && (
        <section className="pdf-preview-overlay" aria-label="PDF preview">
          <header className="pdf-preview-header">
            <strong title={preview.attachment.originalName}>{preview.attachment.originalName}</strong>
            <div>
              {preview.status === 'error' && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => openPdf(preview.attachment)}
                >
                  Retry
                </button>
              )}
              <button className="btn btn-ghost btn-sm" type="button" onClick={closePdfPreview}>
                Close preview
              </button>
            </div>
          </header>
          {preview.status === 'loading' && (
            <div className="pdf-preview-loading" role="status">Loading PDF preview…</div>
          )}
          {preview.status === 'error' && (
            <div className="pdf-preview-error" role="alert">
              {preview.message || 'The PDF preview did not load. Retry or download the document.'}
            </div>
          )}
          {preview.src && (
            <iframe
              key={`${preview.attachment._id}-${preview.src}`}
              className="pdf-preview-frame"
              title={`PDF preview: ${preview.attachment.originalName}`}
              src={preview.src}
              onLoad={() => {
                window.clearTimeout(previewTimer.current);
                setPreview((current) => current?.attachment._id === preview.attachment._id
                  ? { ...current, status: 'ready' }
                  : current);
              }}
              onError={() => {
                window.clearTimeout(previewTimer.current);
                setPreview((current) => current?.attachment._id === preview.attachment._id
                  ? { ...current, status: 'error' }
                  : current);
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
