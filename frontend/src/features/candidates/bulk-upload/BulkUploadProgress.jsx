import React from 'react';
import api from '../../../services/api';

const BulkUploadProgress = ({ jobId, jobState, onReset, onDone }) => {
  const { state, progress, processed, succeeded, duplicates, failed, totalRows, errorReportUrl, error } = jobState;

  const handleDownloadReport = async () => {
    try {
      let reportUrl = errorReportUrl || `/candidates/bulk-upload/${jobId}/report`;
      // Backend may return "/api/candidates/..." — strip prefix so buildApiUrl doesn't double /api
      if (reportUrl.startsWith('/api/')) {
        reportUrl = reportUrl.slice(4);
      }
      const response = await api.get(reportUrl, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `bulk_upload_report_${jobId || 'export'}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Failed to download error report:', err);
      alert(err?.message || 'Failed to download error report');
    }
  };

  const dupsCount = duplicates || 0;

  if (state === 'active') {
    return (
      <div className="flex flex-col items-center justify-center py-10 space-y-6">
        <div className="relative w-36 h-36 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90">
            <circle cx="72" cy="72" r="64" className="stroke-slate-100" strokeWidth="10" fill="none" />
            <circle
              cx="72"
              cy="72"
              r="64"
              className="stroke-blue-600 transition-all duration-500"
              strokeWidth="10"
              fill="none"
              strokeDasharray={`${(progress / 100) * 402} 402`}
            />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="text-3xl font-extrabold text-blue-600">{progress}%</span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
              {processed} {totalRows ? `/ ${totalRows}` : 'processed'}
            </span>
          </div>
        </div>

        <div className="text-center space-y-1">
          <h3 className="text-xl font-bold text-slate-800">Importing Candidates...</h3>
          <p className="text-xs text-slate-500">Processing in background. You can close this modal without interrupting the import.</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-bold pt-2">
          <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100">
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>{succeeded} Succeeded</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100">
            <span className="material-symbols-outlined text-base">file_copy</span>
            <span>{dupsCount} Duplicates</span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-600 bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-100">
            <span className="material-symbols-outlined text-base">warning</span>
            <span>{failed} Failed</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-center">
          <span className="material-symbols-outlined text-3xl text-slate-400 mb-1">description</span>
          <div className="text-2xl font-bold text-slate-800">{processed}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Rows</div>
        </div>

        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
          <span className="material-symbols-outlined text-3xl text-emerald-500 mb-1">check_circle</span>
          <div className="text-2xl font-bold text-emerald-700">{succeeded}</div>
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Imported</div>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-center">
          <span className="material-symbols-outlined text-3xl text-amber-500 mb-1">file_copy</span>
          <div className="text-2xl font-bold text-amber-700">{dupsCount}</div>
          <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Duplicates</div>
        </div>

        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center">
          <span className="material-symbols-outlined text-3xl text-rose-500 mb-1">warning</span>
          <div className="text-2xl font-bold text-rose-700">{failed}</div>
          <div className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">Failed / Errors</div>
        </div>
      </div>

      {(error || jobState.summaryError) && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-base">warning</span>
          <span>{jobState.summaryError || error}</span>
        </div>
      )}

      {(failed > 0 || dupsCount > 0 || errorReportUrl) && (
        <div className="border border-rose-200 bg-rose-50/50 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl text-rose-600">article</span>
            <div>
              <div className="font-bold text-rose-800 text-sm">Download Error & Warning Report</div>
              <div className="text-xs text-rose-600">CSV report detailing every duplicate row, validation error, and soft warning.</div>
            </div>
          </div>
          <button
            onClick={handleDownloadReport}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1 shrink-0"
          >
            <span className="material-symbols-outlined text-sm">download</span> Download Report
          </button>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button
          onClick={onReset}
          className="px-5 py-2.5 font-bold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
        >
          Import Another File
        </button>
        <button
          onClick={onDone}
          className="px-6 py-2.5 font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );
};

export default BulkUploadProgress;
