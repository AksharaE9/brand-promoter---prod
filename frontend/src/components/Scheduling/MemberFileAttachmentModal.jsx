import React, { useState, useEffect, useCallback, useRef } from 'react';
import { schedulingLeadApi } from '../../services/schedulingLeadApi';
import { MAX_UPLOAD_BYTES } from '../../lib/uploadLimits';
import { buildApiUrl, downloadAuthenticatedFile } from '../../lib/api';

export default function MemberFileAttachmentModal({ memberId, memberName, initialFiles = [], selectedDate: propSelectedDate, onClose, onRefresh }) {
  const [selectedDate, setSelectedDate] = useState(propSelectedDate);
  const [files, setFiles] = useState(() => initialFiles || []);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isFirstRender = useRef(true);

  const fetchFiles = useCallback(async (date) => {
    setLoadingFiles(true);
    setError('');
    try {
      const res = await schedulingLeadApi.getMemberFiles(memberId, { from: date, to: date });
      if (res && res.success && res.data) {
        // GET /files returns grouped structure: [{ date: 'YYYY-MM-DD', files: [...] }]
        const group = res.data.find(g => g.date === date);
        setFiles(group ? group.files : []);
      } else {
        setFiles([]);
        setError(res?.message || 'Failed to fetch files for this date.');
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch files for this date.');
    } finally {
      setLoadingFiles(false);
    }
  }, [memberId]);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (initialFiles && initialFiles.length > 0 && selectedDate === propSelectedDate) {
        return;
      }
    }
    if (selectedDate) {
      fetchFiles(selectedDate);
    }
  }, [selectedDate, fetchFiles, initialFiles, propSelectedDate]);

  const handleDownload = async (fileId, filename) => {
    setError('');
    setSuccess('');
    try {
      await downloadAuthenticatedFile(`/scheduling/members/${memberId}/files/${fileId}/download`, filename);
    } catch (err) {
      console.error('[SchedulingDownload] Error downloading attachment:', err);
      setError(`${filename} — ${err.message || "File wasn't available on site"}`);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Type validation
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith('.csv');
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls');
    if (!isCsv && !isExcel) {
      setError('Only CSV and Excel files are allowed for scheduling attachments.');
      setSelectedFile(null);
      return;
    }

    // Size validation
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('File exceeds the 10 MB limit. Split it into smaller files if needed.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setError('');
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please select a file to upload.');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const res = await schedulingLeadApi.uploadMemberFile(memberId, selectedFile, selectedDate, note);
      if (res && res.success && res.data) {
        setSuccess('File uploaded successfully!');
        setFiles(prev => [...prev, res.data]);
        setSelectedFile(null);
        setNote('');
        if (onRefresh) onRefresh();
      } else {
        setError(res?.message || 'Failed to upload file.');
      }
    } catch (err) {
      setError(err.message || 'Failed to upload file.');
    } finally {
      setUploading(false);
    }
  };

  const normalizedFiles = files.map((f) => {
    return {
      id: f.id,
      fileUrl: f.fileUrl,
      filename: f.filename || f.fileUrl.split('/').pop() || 'file',
      note: f.note,
      uploadedBy: f.uploadedBy?.fullName || f.uploaded_by || 'User',
      createdAt: f.createdAt || f.created_at,
    };
  });

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Attachments: {memberName}</h2>
              <p className="text-xs text-slate-500 font-medium">Attach CSV or Excel files for {selectedDate}</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 w-fit">
            <span className="material-symbols-outlined text-slate-400 text-sm">calendar_today</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer"
            />
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {error && <div className="p-3 text-red-600 bg-red-50 border border-red-100 rounded-xl text-xs">{error}</div>}
          {success && <div className="p-3 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl text-xs">{success}</div>}

          {/* List of existing files */}
          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider font-bold text-slate-400">Attached Files</h3>
            {loadingFiles ? (
              <div className="py-8 text-center text-slate-400 text-xs animate-pulse flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Loading files...
              </div>
            ) : normalizedFiles.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs italic bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                No files uploaded for this date yet.
              </div>
            ) : (
              <div className="space-y-2">
                {normalizedFiles.map((f) => (
                  <div key={f.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="min-w-0 flex-1 pr-3">
                      <button type="button" onClick={() => handleDownload(f.id, f.filename)} className="text-xs font-bold text-blue-600 hover:underline text-left truncate block w-full">
                        {f.filename}
                      </button>
                      {f.note && <p className="text-[11px] text-slate-500 mt-1 italic">"{f.note}"</p>}
                      <div className="text-[9px] text-slate-400 mt-0.5">
                        Uploaded by {f.uploadedBy} at {f.createdAt ? new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown'}
                      </div>
                    </div>
                    <button type="button" onClick={() => handleDownload(f.id, f.filename)} className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center">
                      <span className="material-symbols-outlined text-sm">download</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upload new file form */}
          <form onSubmit={handleUpload} className="space-y-4 pt-4 border-t border-slate-100">
            <h3 className="text-xs uppercase tracking-wider font-bold text-slate-400">Upload New Attachment</h3>
            <div className="space-y-2">
              <label className="flex flex-col items-center justify-center gap-2 w-full h-24 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-blue-500 hover:bg-blue-50/20 transition-all group">
                <span className="material-symbols-outlined text-3xl text-slate-300 group-hover:text-blue-500 transition-colors">upload_file</span>
                <span className="text-xs text-slate-400 font-medium group-hover:text-blue-500">
                  {selectedFile ? selectedFile.name : 'Select File (Max 10MB, CSV/Excel only)'}
                </span>
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                />
              </label>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-slate-400">Short Note (Optional)</label>
              <input
                type="text"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-none text-xs"
                placeholder="e.g. DND report, follow-up sheet..."
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-1.5"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Uploading...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm">cloud_upload</span>
                  Upload Attachment
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

