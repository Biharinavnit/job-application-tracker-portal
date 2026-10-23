
import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';

const STAGES = ['Saved', 'Applied', 'OA', 'Phone Screen', 'Interview', 'Offer', 'Rejected', 'Withdrawn', 'Accepted'];
const SOURCES = ['LinkedIn', 'Indeed', 'Company Site', 'Referral', 'Naukri', 'Internshala', 'Other'];
const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;

const EMPTY = {
  company: '', role: '', location: '', jobUrl: '', source: 'LinkedIn',
  salaryNote: '', stage: 'Saved', statusNote: '', appliedDate: '',
  interviewDate: '', deadlineDate: '', notes: '', tags: '', priority: false,
};

export default function ApplicationModal({ open, onClose, onSave, onDocumentsChanged, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [savedApplicationId, setSavedApplicationId] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [activeUpload, setActiveUpload] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentMessage, setAttachmentMessage] = useState('');
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const pdfInput = useRef(null);
  const docxInput = useRef(null);

  useEffect(() => {
    if (initial) {
      setForm({
        ...EMPTY,
        ...initial,
        appliedDate:   initial.appliedDate   ? initial.appliedDate.slice(0, 10)   : '',
        interviewDate: initial.interviewDate ? initial.interviewDate.slice(0, 10) : '',
        deadlineDate:  initial.deadlineDate  ? initial.deadlineDate.slice(0, 10)  : '',
        tags: Array.isArray(initial.tags) ? initial.tags.join(', ') : '',
      });
    } else {
      setForm(EMPTY);
    }
    setSavedApplicationId(initial?._id || '');
    setAttachments([]);
    setPendingFiles([]);
    setAttachmentError('');
    setAttachmentMessage('');
    setImportMenuOpen(false);
  }, [initial, open]);

  useEffect(() => {
    if (!open || !initial?._id) return undefined;
    let cancelled = false;
    setLoadingAttachments(true);
    api.get(`/applications/${initial._id}/attachments`)
      .then(({ data }) => {
        if (!cancelled) setAttachments(data.data);
      })
      .catch((error) => {
        if (!cancelled) {
          setAttachmentError(error.response?.data?.message || 'Unable to load attached documents.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAttachments(false);
      });
    return () => { cancelled = true; };
  }, [open, initial?._id]);

  if (!open) return null;

  const handle = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const uploadFile = async (applicationId, file) => {
    const body = new FormData();
    body.append('document', file);
    const { data } = await api.post(`/applications/${applicationId}/attachments`, body, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setAttachments((current) => [...current, data.data]);
    return data.data;
  };

  const selectImport = (type) => {
    setImportMenuOpen(false);
    const input = type === 'pdf' ? pdfInput.current : docxInput.current;
    if (input) {
      input.value = '';
      input.click();
    }
  };

  const handleFileSelected = async (event, type) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAttachmentError('');
    setAttachmentMessage('');
    const expectedExtension = type === 'pdf' ? '.pdf' : '.docx';
    if (!file.name.toLowerCase().endsWith(expectedExtension)) {
      setAttachmentError(`Choose a ${type === 'pdf' ? 'PDF' : 'DOCX'} file.`);
      return;
    }
    if (!file.size) {
      setAttachmentError('The selected document is empty.');
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      setAttachmentError(`Document exceeds the ${Math.round(MAX_DOCUMENT_SIZE / (1024 * 1024))} MB upload limit.`);
      return;
    }

    const applicationId = savedApplicationId || initial?._id;
    if (!applicationId) {
      setPendingFiles((current) => {
        const duplicate = current.some((item) =>
          item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
        );
        return duplicate ? current : [...current, file];
      });
      setAttachmentMessage('Document selected. It will be attached when you save this application.');
      return;
    }

    setActiveUpload(true);
    try {
      await uploadFile(applicationId, file);
      setAttachmentMessage('Document attached successfully.');
      onDocumentsChanged?.();
    } catch (error) {
      setAttachmentError(error.response?.data?.message || 'Unable to attach the selected document.');
    } finally {
      setActiveUpload(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAttachmentError('');
    setAttachmentMessage('');
    try {
      const applicationId = await onSave({
        ...form,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      }, savedApplicationId || undefined);
      setSavedApplicationId(applicationId);
      for (const file of pendingFiles) {
        setActiveUpload(true);
        try {
          await uploadFile(applicationId, file);
          setPendingFiles((current) => current.filter((pending) => pending !== file));
        } catch (error) {
          setAttachmentError(error.response?.data?.message || `Unable to attach ${file.name}.`);
          return;
        } finally {
          setActiveUpload(false);
        }
      }
      if (pendingFiles.length) onDocumentsChanged?.();
      onClose();
    } catch (error) {
      setAttachmentError(error.response?.data?.message || 'Unable to save this application.');
    } finally {
      setSaving(false);
    }
  };

  const downloadAttachment = async (attachment) => {
    setAttachmentError('');
    try {
      const { data } = await api.get(
        `/applications/${savedApplicationId || initial._id}/attachments/${attachment._id}`,
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
    } catch (error) {
      setAttachmentError(error.response?.data?.message || 'Unable to download this document.');
    }
  };

  const viewAttachment = async (attachment) => {
    setAttachmentError('');
    if (attachment.documentType !== 'pdf') {
      setAttachmentError('Word document preview is not supported. Download the DOCX file to view it.');
      return;
    }

    const previewTab = window.open('about:blank', '_blank');
    if (!previewTab) {
      setAttachmentError('Your browser blocked the preview tab. Allow pop-ups or use Download instead.');
      return;
    }
    previewTab.opener = null;
    previewTab.document.title = 'Loading document preview…';
    previewTab.document.body.textContent = 'Loading document preview…';

    try {
      const { data } = await api.get(
        `/applications/${savedApplicationId || initial._id}/attachments/${attachment._id}/view`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      previewTab.location.replace(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      previewTab.close();
      setAttachmentError('Unable to open this document preview. Please try Download instead.');
    }
  };

  const deleteAttachment = async (attachment) => {
    if (!window.confirm(`Delete ${attachment.originalName}?`)) return;
    setAttachmentError('');
    try {
      await api.delete(`/applications/${savedApplicationId || initial._id}/attachments/${attachment._id}`);
      setAttachments((current) => current.filter((item) => item._id !== attachment._id));
      setAttachmentMessage('Document deleted.');
      onDocumentsChanged?.();
    } catch (error) {
      setAttachmentError(error.response?.data?.message || 'Unable to delete this document.');
    }
  };

  const formatFileSize = (size) => size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && !activeUpload && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{initial ? '✏️ Edit Application' : '➕ Add Application'}</h2>
          <button className="modal-close" onClick={onClose} disabled={saving || activeUpload}>✕</button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-grid">
              {/* Company */}
              <div className="form-group">
                <label className="form-label">Company *</label>
                <input className="form-input" name="company" placeholder="Google, Microsoft…" value={form.company} onChange={handle} required />
              </div>

              {/* Role */}
              <div className="form-group">
                <label className="form-label">Role / Title *</label>
                <input className="form-input" name="role" placeholder="SDE Intern, Frontend Dev…" value={form.role} onChange={handle} required />
              </div>

              {/* Location */}
              <div className="form-group">
                <label className="form-label">Location</label>
                <input className="form-input" name="location" placeholder="Remote / Bangalore…" value={form.location} onChange={handle} />
              </div>

              {/* Source */}
              <div className="form-group">
                <label className="form-label">Source</label>
                <select className="form-select" name="source" value={form.source} onChange={handle}>
                  {SOURCES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Stage */}
              <div className="form-group">
                <label className="form-label">Stage</label>
                <select className="form-select" name="stage" value={form.stage} onChange={handle}>
                  {STAGES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Salary */}
              <div className="form-group">
                <label className="form-label">Salary Note</label>
                <input className="form-input" name="salaryNote" placeholder="₹12 LPA / $90k…" value={form.salaryNote} onChange={handle} />
              </div>

              {/* Job URL */}
              <div className="form-group form-full">
                <label className="form-label">Job URL</label>
                <input className="form-input" name="jobUrl" type="url" placeholder="https://…" value={form.jobUrl} onChange={handle} />
              </div>

              {/* Dates */}
              <div className="form-group">
                <label className="form-label">Applied Date</label>
                <input className="form-input" type="date" name="appliedDate" value={form.appliedDate} onChange={handle} />
              </div>

              <div className="form-group">
                <label className="form-label">Interview Date</label>
                <input className="form-input" type="date" name="interviewDate" value={form.interviewDate} onChange={handle} />
              </div>

              <div className="form-group">
                <label className="form-label">Deadline</label>
                <input className="form-input" type="date" name="deadlineDate" value={form.deadlineDate} onChange={handle} />
              </div>

              {/* Priority */}
              <div className="form-group" style={{ justifyContent: 'flex-end' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 24 }}>
                  <input type="checkbox" name="priority" checked={form.priority} onChange={handle} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                  ⭐ Mark as Priority
                </label>
              </div>

              {/* Status note */}
              <div className="form-group form-full">
                <label className="form-label">Status Note</label>
                <input className="form-input" name="statusNote" placeholder="Heard back from HR…" value={form.statusNote} onChange={handle} />
              </div>

              {/* Tags */}
              <div className="form-group form-full">
                <label className="form-label">Tags (comma separated)</label>
                <input className="form-input" name="tags" placeholder="react, fullstack, remote…" value={form.tags} onChange={handle} />
              </div>

              <div className="form-group form-full">
                <div className="notes-heading">
                  <label className="form-label" htmlFor="application-notes">Notes &amp; Documents</label>
                  <div className="notes-import-menu">
                    <button
                      className="notes-import-trigger"
                      type="button"
                      aria-label="Import a document"
                      aria-expanded={importMenuOpen}
                      onClick={() => setImportMenuOpen((openMenu) => !openMenu)}
                    >
                      +
                    </button>
                    {importMenuOpen && (
                      <div className="notes-import-options" role="menu">
                        <button type="button" role="menuitem" onClick={() => selectImport('pdf')}>Import PDF</button>
                        <button type="button" role="menuitem" onClick={() => selectImport('docx')}>Import Word (DOCX)</button>
                      </div>
                    )}
                  </div>
                </div>
                <textarea
                  className="form-textarea notes-editor"
                  id="application-notes"
                  name="notes"
                  rows={8}
                  placeholder="Interview prep notes, contacts, next steps…"
                  value={form.notes}
                  onChange={handle}
                />
                <input ref={pdfInput} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => handleFileSelected(event, 'pdf')} />
                <input ref={docxInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={(event) => handleFileSelected(event, 'docx')} />
                {attachmentError && <div className="error-msg" role="alert">{attachmentError}</div>}
                {attachmentMessage && <div className="auth-success-msg" role="status">{attachmentMessage}</div>}

                <div className="notes-attachments" aria-live="polite">
                  <div className="notes-attachments-title">Attached documents</div>
                  {loadingAttachments ? (
                    <div className="notes-empty">Loading documents…</div>
                  ) : attachments.length === 0 && pendingFiles.length === 0 ? (
                    <div className="notes-empty">No documents attached.</div>
                  ) : (
                    <ul className="notes-attachment-list">
                      {attachments.map((attachment) => (
                        <li className="notes-attachment" key={attachment._id}>
                          <span className="notes-attachment-info">
                            <strong>{attachment.originalName}</strong>
                            <span>{attachment.documentType.toUpperCase()} · {formatFileSize(attachment.size)}</span>
                          </span>
                          <span className="notes-attachment-actions">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => viewAttachment(attachment)}>View</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadAttachment(attachment)}>Download</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => deleteAttachment(attachment)}>Delete</button>
                          </span>
                        </li>
                      ))}
                      {pendingFiles.map((file) => (
                        <li className="notes-attachment notes-attachment-pending" key={`${file.name}-${file.lastModified}`}>
                          <span className="notes-attachment-info">
                            <strong>{file.name}</strong>
                            <span>{file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOCX'} · {formatFileSize(file.size)} · Pending save</span>
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Remove ${file.name}`}
                            onClick={() => setPendingFiles((current) => current.filter((pending) => pending !== file))}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {activeUpload && <div className="notes-empty">Uploading document…</div>}
                  <div className="notes-import-help">PDF and DOCX only. Imported text is not extracted into Notes.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving || activeUpload}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || activeUpload || loadingAttachments}>
              {saving || activeUpload ? 'Saving…' : initial ? 'Update Application' : 'Add Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}