import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

const formatTimestamp = (value) => new Date(value).toLocaleString('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function TrashPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState('');

  const loadTrash = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/trash');
      setItems(data.data);
      setRetentionDays(data.retentionDays);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load Recently Deleted.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const restoreItem = async (item) => {
    setPendingId(item.id);
    setError('');
    try {
      const { data } = await api.post(`/trash/${item.type}/${item.id}/restore`);
      toast.success(data.message || 'Item restored');
      data.warnings?.forEach((warning) => toast.error(warning, { duration: 6000 }));
      await loadTrash();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to restore this item.');
    } finally {
      setPendingId('');
    }
  };

  const permanentlyDelete = async (item) => {
    if (!window.confirm(`Permanently delete ${item.name}? This cannot be undone.`)) return;
    setPendingId(item.id);
    setError('');
    try {
      const { data } = await api.delete(`/trash/${item.type}/${item.id}`);
      toast.success(data.message || 'Item permanently deleted');
      await loadTrash();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Permanent deletion failed. You can retry it.');
    } finally {
      setPendingId('');
    }
  };

  return (
    <section className="trash-page">
      <header className="page-header trash-header">
        <div>
          <h1 className="page-title">Recently Deleted</h1>
          <p className="page-subtitle">
            Items are permanently removed {retentionDays} days after deletion.
          </p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={loadTrash} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {user?.isDemo && (
        <div className="trash-notice" role="status">
          The demo account is read-only. Its sample items cannot be restored or permanently deleted.
        </div>
      )}
      {error && <div className="error-msg trash-error" role="alert">{error}</div>}

      <div className="table-wrap trash-wrap" aria-live="polite">
        {loading ? (
          <div className="loading-wrap"><div className="spinner" /></div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🗑️</div>
            <div className="empty-text">Recently Deleted is empty</div>
            <div className="empty-subtext">Deleted applications and documents will appear here.</div>
          </div>
        ) : (
          <div className="trash-list">
            {items.map((item) => {
              const isPending = pendingId === item.id;
              return (
                <article className="trash-item" key={`${item.type}-${item.id}`}>
                  <div className="trash-item-details">
                    <span className={`trash-type trash-type-${item.type}`}>
                      {item.type === 'application' ? 'Application' : 'Document'}
                    </span>
                    <h2>{item.name}</h2>
                    {item.applicationName && <p>Application: {item.applicationName}</p>}
                    <p>Deleted {formatTimestamp(item.deletedAt)}</p>
                    <p className={item.daysRemaining <= 3 ? 'trash-expiring' : 'trash-retention'}>
                      {item.retentionStatus}
                      {item.purgePending ? ' · permanent cleanup will retry automatically' : ''}
                    </p>
                  </div>
                  <div className="trash-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={() => restoreItem(item)}
                      disabled={isPending || user?.isDemo || item.purgePending || item.daysRemaining === 0}
                    >
                      {isPending ? 'Working…' : 'Restore'}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      type="button"
                      onClick={() => permanentlyDelete(item)}
                      disabled={isPending || user?.isDemo}
                    >
                      {isPending ? 'Working…' : 'Delete Permanently'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
