import React, { useState } from 'react';
import api from '../../services/api';
import { useBulkUploadJob } from '../../features/candidates/bulk-upload/useBulkUploadJob';
import BulkUploadProgress from '../../features/candidates/bulk-upload/BulkUploadProgress';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadLimits';

const BulkUploadModal = ({ isOpen, onClose, onImportComplete }) => {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  const { jobId, jobState, startJob, resetJob } = useBulkUploadJob();

  if (!isOpen) return null;

  const validateFile = (selectedFile) => {
    if (!selectedFile) return 'No file selected';

    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      return 'Invalid file type. Only CSV (.csv) and Excel (.xlsx, .xls) files are accepted.';
    }

    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      return 'File exceeds the 10 MB limit. Split it into smaller files if needed.';
    }

    return null;
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.dataTransfer?.files[0] || e.target?.files[0];
    if (!selectedFile) return;

    const validationError = validateFile(selectedFile);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }

    setError('');
    setFile(selectedFile);
    uploadAndStartImport(selectedFile);
  };

  const uploadAndStartImport = async (targetFile) => {
    setIsUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', targetFile);

    try {
      // POST returns 202 Accepted in under 1 sec
      const { data } = await api.post('/candidates/bulk-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const assignedJobId = data.jobId || data.data?.jobId;
      if (assignedJobId) {
        startJob(assignedJobId);
      } else {
        throw new Error('Server did not return a valid jobId');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/candidates/bulk-upload/template/download', {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'candidate_bulk_upload_template.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setError('Failed to download candidate template');
    }
  };

  const handleReset = () => {
    resetJob();
    setFile(null);
    setError('');
  };

  const handleDone = () => {
    if (onImportComplete) {
      onImportComplete();
    }
    handleReset();
    onClose();
  };

  const isJobActiveOrDone = jobId && (jobState.state === 'active' || jobState.state === 'completed' || jobState.state === 'failed');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm modal-overlay-fade" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] modal-scale-up border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b flex justify-between items-center bg-slate-50">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800">Bulk Candidate Upload</h2>
            <p className="text-xs text-slate-500 mt-0.5">Import candidates from CSV or XLSX files in the background</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors border shadow-sm"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {isJobActiveOrDone ? (
            <BulkUploadProgress
              jobId={jobId}
              jobState={jobState}
              onReset={handleReset}
              onDone={handleDone}
            />
          ) : (
            <div className="space-y-6">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFileSelect(e);
                }}
                className="border-2 border-dashed border-blue-300 bg-blue-50/40 rounded-2xl p-12 text-center relative hover:bg-blue-50 transition-colors flex flex-col items-center justify-center"
              >
                <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-4 shadow-sm">
                  <span className="material-symbols-outlined text-3xl">cloud_upload</span>
                </div>
                <h3 className="text-lg font-extrabold text-slate-800">Drag your CSV or XLSX file here</h3>
                <p className="text-xs text-slate-500 mt-1">or click to browse from your computer</p>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-4 px-3 py-1 bg-white border rounded-full">
                  Max file size: 10MB
                </span>
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  disabled={isUploading}
                />
              </div>

              {error && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">error</span>
                  <span>{error}</span>
                </div>
              )}

              {isUploading && (
                <div className="text-center text-blue-600 font-bold text-sm flex items-center justify-center gap-2 py-2">
                  <span className="material-symbols-outlined animate-spin text-lg">sync</span>
                  <span>Uploading file and starting background queue...</span>
                </div>
              )}

              <div className="flex justify-center border-t pt-4">
                <button
                  onClick={handleDownloadTemplate}
                  className="text-blue-600 text-xs font-extrabold hover:underline flex items-center gap-1 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl transition-all"
                >
                  <span className="material-symbols-outlined text-base">download</span> Download Template (.CSV)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkUploadModal;
