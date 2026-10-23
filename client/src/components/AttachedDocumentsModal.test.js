import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import AttachedDocumentsModal from './AttachedDocumentsModal';

jest.mock('../utils/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const application = { _id: 'app-1', company: 'Example Co', role: 'Engineer' };
const attachments = [
  { _id: 'pdf-1', originalName: 'first.pdf', documentType: 'pdf', size: 100 },
  { _id: 'pdf-2', originalName: 'second.pdf', documentType: 'pdf', size: 200 },
];

let container;
let root;

const renderModal = async () => {
  useAuth.mockReturnValue({ user: {} });
  api.get.mockImplementation((path) => path.endsWith('/view')
    ? Promise.resolve({
      status: 206,
      headers: { 'content-type': 'application/pdf' },
      data: new Blob(['%PDF-']),
    })
    : Promise.resolve({ data: { data: attachments } }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AttachedDocumentsModal application={application} onClose={jest.fn()} />
    );
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  api.delete.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
});

test('each PDF opens its own authenticated streaming URL', async () => {
  api.post.mockImplementation((path) => Promise.resolve({
    data: { url: `/api/${path.split('/').slice(1, -1).join('/')}/view` },
  }));
  await renderModal();

  const viewButtons = [...container.querySelectorAll('button')]
    .filter((button) => button.textContent === 'View PDF');

  await act(async () => {
    viewButtons[0].click();
    await Promise.resolve();
  });
  expect(container.querySelector('iframe').getAttribute('src')).toContain('/pdf-1/view');
  expect(api.post.mock.calls.at(-1)[0]).toBe('/applications/app-1/attachments/pdf-1/preview-session');
  expect(api.get).toHaveBeenLastCalledWith(
    '/api/applications/app-1/attachments/pdf-1/view',
    expect.objectContaining({
      headers: { Range: 'bytes=0-0' },
      responseType: 'blob',
      withCredentials: true,
    })
  );

  await act(async () => {
    container.querySelector('.pdf-preview-header button:last-child').click();
    await Promise.resolve();
  });
  await act(async () => {
    viewButtons[1].click();
    await Promise.resolve();
  });
  expect(container.querySelector('iframe').getAttribute('src')).toContain('/pdf-2/view');
  expect(api.post.mock.calls.at(-1)[0]).toBe('/applications/app-1/attachments/pdf-2/preview-session');
  expect(api.get).toHaveBeenLastCalledWith(
    '/api/applications/app-1/attachments/pdf-2/view',
    expect.objectContaining({ headers: { Range: 'bytes=0-0' }, responseType: 'blob' })
  );
});

test('preview errors provide retry and close controls', async () => {
  api.post
    .mockRejectedValueOnce({ response: { data: { message: 'Preview unavailable.' } } })
    .mockResolvedValueOnce({ data: { url: '/api/applications/app-1/attachments/pdf-1/view' } });
  await renderModal();
  const viewButton = [...container.querySelectorAll('button')]
    .find((button) => button.textContent === 'View PDF');

  await act(async () => {
    viewButton.click();
    await Promise.resolve();
  });
  expect(container.textContent).toContain('Preview unavailable.');
  const retryButton = [...container.querySelectorAll('button')]
    .find((button) => button.textContent === 'Retry');
  expect(retryButton).toBeDefined();

  await act(async () => {
    retryButton.click();
    await Promise.resolve();
  });
  expect(container.querySelector('iframe').getAttribute('src')).toContain('/view');

  await act(async () => {
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Close preview')
      .click();
    await Promise.resolve();
  });
  expect(container.querySelector('iframe')).toBeNull();
});

test('does not render a non-PDF response as a successful preview', async () => {
  api.post.mockResolvedValue({
    data: { url: '/api/applications/app-1/attachments/pdf-1/view' },
  });
  api.get.mockImplementation((path) => path.endsWith('/view')
    ? Promise.resolve({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: new Blob(['Dashboard']),
    })
    : Promise.resolve({ data: { data: attachments } }));
  await renderModal();
  api.get.mockImplementation((path) => path.endsWith('/view')
    ? Promise.resolve({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: new Blob(['Dashboard']),
    })
    : Promise.resolve({ data: { data: attachments } }));
  const viewButton = [...container.querySelectorAll('button')]
    .find((button) => button.textContent === 'View PDF');

  await act(async () => {
    viewButton.click();
    await Promise.resolve();
  });

  expect(container.querySelector('iframe')).toBeNull();
  expect(container.textContent).toContain('preview endpoint did not return a PDF');
});
