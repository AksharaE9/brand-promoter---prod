import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const BulkUploadModal = ({ isOpen, onClose, onImportComplete }) => {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionData, setSessionData] = useState(null);
  const [columnMapping, setColumnMapping] = useState({});
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  
  const systemFields = [
    { key: 'fullName', label: 'Full Name ✱' },
    { key: 'email', label: 'Email Address' },
    { key: 'phone', label: 'Phone Number ✱' },
    { key: 'location', label: 'Location / City' },
    { key: 'role', label: 'Role / Designation' },
    { key: 'ignore', label: '── Ignore This Column ──' }
  ];

  const handleFileDrop = async (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer?.files[0] || e.target?.files[0];
    if (!droppedFile) return;
    
    setFile(droppedFile);
    setIsProcessing(true);
    setError('');

    const formData = new FormData();
    formData.append('file', droppedFile);

    try {
      const { data } = await api.post('/candidates/bulk-upload/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSessionData(data.data);
      
      // Auto-suggest mappings
      const initialMapping = {};
      data.data.detectedColumns.forEach(col => {
        const lowerCol = col.toLowerCase().replace(/[^a-z]/g, '');
        if (lowerCol.includes('name') || lowerCol === 'fullname') initialMapping[col] = 'fullName';
        else if (lowerCol.includes('mail')) initialMapping[col] = 'email';
        else if (lowerCol.includes('phone') || lowerCol.includes('contact') || lowerCol.includes('mobile')) initialMapping[col] = 'phone';
        else if (lowerCol.includes('location') || lowerCol.includes('city') || lowerCol.includes('place')) initialMapping[col] = 'location';
        else if (lowerCol.includes('role') || lowerCol.includes('position') || lowerCol.includes('designation') || lowerCol.includes('title') || lowerCol.includes('job')) initialMapping[col] = 'role';
        else initialMapping[col] = 'ignore';
      });
      setColumnMapping(initialMapping);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/candidates/bulk-upload/template/download', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'candidate_template.csv';
      a.click();
    } catch (err) {
      setError('Failed to download template');
    }
  };

  const handleStartImport = async () => {
    setIsProcessing(true);
    setError('');
    try {
      const { data } = await api.post('/candidates/bulk-upload/process', {
        sessionId: sessionData.sessionId,
        columnMapping
      });
      setJobId(data.data.jobId);
      setStep(3);
      pollProgress(data.data.jobId);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start import');
      setIsProcessing(false);
    }
  };

  const pollProgress = (id) => {
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get(`/candidates/bulk-upload/jobs/${id}/status`);
        setProgress(data.data.progress);
        
        if (data.data.state === 'completed' || data.data.state === 'failed') {
          clearInterval(interval);
          setResult(data.data.result);
          setStep(4);
        }
      } catch (err) {
        clearInterval(interval);
        setError('Failed to fetch progress');
        setStep(4);
      }
    }, 1500);
  };

  const handleDownloadErrors = async () => {
    try {
      const response = await api.get(`/candidates/bulk-upload/jobs/${jobId}/errors?format=csv`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `import_errors.csv`;
      a.click();
    } catch (err) {
      setError('Failed to download errors');
    }
  };

  if (!isOpen) return null;

  // Only fullName is required — email, location, role are all optional
  const isMappingValid = Object.values(columnMapping).includes('fullName');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm modal-overlay-fade" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-4xl shadow-xl flex flex-col max-h-[90vh] modal-scale-up">
        
        <div className="p-6 border-b flex justify-between items-center bg-slate-50 rounded-t-2xl">
          <h2 className="text-xl font-bold">Bulk Candidate Upload</h2>
          <button onClick={onClose} className="os-icon-btn"><span className="material-symbols-outlined">close</span></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {step === 1 && (
            <div className="space-y-6">
              <div className="border-2 border-dashed border-blue-300 bg-blue-50/50 rounded-2xl p-12 text-center relative hover:bg-blue-50 transition-colors">
                <span className="material-symbols-outlined text-6xl text-blue-500 mb-4">cloud_upload</span>
                <h3 className="text-lg font-bold text-slate-700">Drag your CSV or XLSX file here</h3>
                <p className="text-sm text-slate-500 mt-2">or click to browse</p>
                <p className="text-xs text-slate-400 mt-4">Max file size: 20MB</p>
                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".csv,.xlsx" onChange={handleFileDrop} disabled={isProcessing} />
              </div>
              {error && <div className="text-red-500 bg-red-50 p-3 rounded-lg text-sm">{error}</div>}
              {isProcessing && <div className="text-center text-blue-600 font-bold"><span className="material-symbols-outlined animate-spin align-middle mr-2">sync</span> Uploading...</div>}
              <div className="flex justify-center">
                <button onClick={handleDownloadTemplate} className="text-blue-600 text-sm font-bold hover:underline flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">download</span> Download Template
                </button>
              </div>
            </div>
          )}

          {step === 2 && sessionData && (
            <div className="space-y-6">
              <h3 className="text-lg font-bold">Map Your Columns</h3>
              <p className="text-sm text-slate-500">We detected {sessionData.detectedColumns.length} columns in your file. Please map them to the correct candidate fields.</p>
              
              <div className="bg-white border rounded-xl overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 border-b">Your File Column</th>
                      <th className="px-4 py-3 border-b">Maps To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sessionData.detectedColumns.map(col => (
                      <tr key={col}>
                        <td className="px-4 py-3 font-medium text-slate-700">{col}</td>
                        <td className="px-4 py-3">
                          <select className="os-input w-full max-w-xs" value={columnMapping[col] || 'ignore'} onChange={e => setColumnMapping(prev => ({...prev, [col]: e.target.value}))}>
                            {systemFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={`p-4 rounded-xl border ${isMappingValid ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {isMappingValid ? (
                  <div className="flex items-center gap-2 font-bold"><span className="material-symbols-outlined">check_circle</span> Ready to import — required fields mapped</div>
                ) : (
                  <div className="flex items-center gap-2 font-bold"><span className="material-symbols-outlined">warning</span> Map at least <strong>Full Name</strong> to continue</div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setStep(1)} className="px-4 py-2 font-bold text-slate-600 bg-slate-100 rounded-lg">Back</button>
                <button onClick={handleStartImport} disabled={!isMappingValid || isProcessing} className="px-6 py-2 font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Next</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="64" cy="64" r="60" className="stroke-slate-100" strokeWidth="8" fill="none" />
                  <circle cx="64" cy="64" r="60" className="stroke-blue-500 transition-all duration-500" strokeWidth="8" fill="none" strokeDasharray={`${progress * 3.77} 377`} />
                </svg>
                <span className="absolute text-2xl font-bold text-blue-600">{progress}%</span>
              </div>
              <div className="text-center">
                <h3 className="text-xl font-bold text-slate-800">Importing candidates...</h3>
                <p className="text-slate-500 mt-2">Please do not close this window</p>
              </div>
            </div>
          )}

          {step === 4 && result && (
            <div className="space-y-6">
              <div className="grid grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <span className="material-symbols-outlined text-3xl text-slate-400 mb-2">description</span>
                  <div className="text-2xl font-bold">{result.total}</div>
                  <div className="text-xs font-bold text-slate-500 uppercase">Total Rows</div>
                </div>
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-center">
                  <span className="material-symbols-outlined text-3xl text-green-500 mb-2">check_circle</span>
                  <div className="text-2xl font-bold text-green-700">{result.imported}</div>
                  <div className="text-xs font-bold text-green-600 uppercase">Successfully Imported</div>
                </div>
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-center">
                  <span className="material-symbols-outlined text-3xl text-blue-500 mb-2">info</span>
                  <div className="text-2xl font-bold text-blue-700">{result.skipped}</div>
                  <div className="text-xs font-bold text-blue-600 uppercase">Duplicates Skipped</div>
                </div>
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
                  <span className="material-symbols-outlined text-3xl text-red-500 mb-2">warning</span>
                  <div className="text-2xl font-bold text-red-700">{result.failed}</div>
                  <div className="text-xs font-bold text-red-600 uppercase">Failed</div>
                </div>
              </div>

              {result.failed > 0 && (
                <div className="mt-6 border border-red-200 rounded-xl overflow-hidden">
                  <div className="bg-red-50 p-4 border-b border-red-200 flex justify-between items-center">
                    <h4 className="font-bold text-red-700 flex items-center gap-2"><span className="material-symbols-outlined">error</span> Error Report</h4>
                    <button onClick={handleDownloadErrors} className="text-sm font-bold text-red-600 hover:underline">Download Error Report</button>
                  </div>
                  <div className="p-4">
                    {result.errors.slice(0, 5).map((err, i) => (
                      <div key={i} className="text-xs text-red-600 mb-2 last:mb-0"><span className="font-bold">Row {err.rowNumber}:</span> {err.errors.join(' | ')}</div>
                    ))}
                    {result.errors.length > 5 && <div className="text-xs text-red-400 mt-2 font-bold">+{result.errors.length - 5} more errors</div>}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => { setStep(1); setSessionData(null); setFile(null); setResult(null); }} className="px-4 py-2 font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Import Another File</button>
                <button onClick={() => { if(onImportComplete) onImportComplete(); onClose(); }} className="px-6 py-2 font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-md">Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkUploadModal;
