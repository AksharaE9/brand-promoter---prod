import React, { useEffect, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { MAX_UPLOAD_BYTES } from '../lib/uploadLimits';

const BulkImportModal = ({ isOpen, onClose, onImportComplete, title, endpoint, templateHeaders }) => {
    const [file, setFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setFile(null);
            setIsUploading(false);
            setResult(null);
            setError('');
        }
    }, [isOpen]);

    const handleClose = () => {
        if (isUploading) return;
        onClose?.();
    };

    const handleFileChange = (e) => {
        const selected = e.target.files?.[0];
        if (!selected) return;

        if (selected.size > MAX_UPLOAD_BYTES) {
            setError('File exceeds the 10 MB limit. Split it into smaller files if needed.');
            setFile(null);
            e.target.value = '';
            return;
        }

        setFile(selected);
        setError('');
        setResult(null);
    };

    const handleUpload = async () => {
        if (!file || isUploading) return;
        setIsUploading(true);
        setError('');
        setResult(null);

        const formData = new FormData();
        formData.append('file', file);

        const token = localStorage.getItem('ats_token');

        try {
            const response = await fetch(buildApiUrl(`/sales${endpoint}`), {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            });

            const resData = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(resData.message || 'Import failed');

            setResult(resData.data || { imported: 0, skipped: 0, errors: [] });
            if (onImportComplete) onImportComplete();
        } catch (err) {
            setError(err.message || 'An error occurred during import.');
        } finally {
            setIsUploading(false);
        }
    };

    const downloadTemplate = () => {
        const csvContent = `\uFEFF${templateHeaders.join(',')}\n`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_${String(title || 'import').toLowerCase().replace(/\s+/g, '_')}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-[#0f1b3e]/60 backdrop-blur-[8px] modal-overlay-fade"
                onClick={handleClose}
            />
            <div className="relative bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden modal-scale-up">
                <div className="p-8">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-2xl font-bold text-[#10193f]">{title}</h3>
                            <p className="text-sm text-[#8b95ad] mt-1">
                                {isUploading
                                    ? 'Please wait while your document is uploaded.'
                                    : result
                                        ? 'Import finished. Review the summary below.'
                                        : 'Upload your file to sync data instantly.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isUploading}
                            className="os-icon-btn disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    {isUploading ? (
                        <div className="flex flex-col items-center justify-center py-14 space-y-5">
                            <div className="relative w-20 h-20">
                                <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
                                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#1f52cc] animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="material-symbols-outlined text-[#1f52cc] text-3xl">upload_file</span>
                                </div>
                            </div>
                            <div className="text-center space-y-1">
                                <p className="text-lg font-bold text-[#10193f]">Uploading document…</p>
                                <p className="text-sm text-[#8b95ad] max-w-xs">
                                    {file?.name || 'Your file'} is being processed. All valid rows will be imported.
                                </p>
                            </div>
                            <div className="w-full max-w-xs h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full w-1/2 rounded-full bg-[#1f52cc] animate-pulse" />
                            </div>
                        </div>
                    ) : !result ? (
                        <div className="space-y-6">
                            <div className="relative p-10 border-2 border-dashed border-[#e2e8f0] rounded-[24px] bg-[#f8fafc] text-center group hover:border-[#1f52cc] hover:bg-blue-50/30 transition-all duration-300">
                                <span className="material-symbols-outlined text-6xl text-[#1f52cc] mb-4 opacity-80 group-hover:scale-110 transition-transform">upload_file</span>
                                <div className="text-[#10193f] font-bold mb-2">
                                    {file ? file.name : 'Drop your file here or click to browse'}
                                </div>
                                <div className="text-[10px] font-bold text-[#8b95ad] uppercase tracking-widest">Supports .xlsx, .xls, .csv</div>
                                <input
                                    type="file"
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={handleFileChange}
                                    accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                />
                            </div>

                            {Array.isArray(templateHeaders) && templateHeaders.length > 0 && (
                                <div className="flex items-center justify-between p-4 bg-[#f1f5f9]/50 rounded-2xl border border-[#f1f5f9]">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                                            <span className="material-symbols-outlined text-[#1f52cc] text-lg">description</span>
                                        </div>
                                        <span className="text-xs font-bold text-[#10193f]">Sample Template</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={downloadTemplate}
                                        className="text-[#1f52cc] text-xs font-bold hover:underline bg-white px-3 py-1.5 rounded-lg border border-blue-50 shadow-sm"
                                    >
                                        Download .csv
                                    </button>
                                </div>
                            )}

                            {error && (
                                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-[11px] font-medium flex items-start gap-3 page-enter">
                                    <span className="material-symbols-outlined text-sm mt-0.5">error</span>
                                    {error}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={handleUpload}
                                disabled={!file}
                                className={`os-btn-primary w-full h-14 text-sm flex items-center justify-center gap-2 shadow-lg ${!file ? 'opacity-50 cursor-not-allowed shadow-none' : 'shadow-blue-100 hover:bg-[#1a47b0]'}`}
                            >
                                <span className="material-symbols-outlined text-xl">cloud_upload</span>
                                <span className="font-bold">Upload & Import</span>
                            </button>
                        </div>
                    ) : (
                        <div className="text-center space-y-6 py-4">
                            <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-2 border ${result.imported > 0 ? 'bg-green-50 text-green-500 border-green-100' : 'bg-amber-50 text-amber-500 border-amber-100'}`}>
                                <span className="material-symbols-outlined text-6xl">
                                    {result.imported > 0 ? 'check_circle' : 'warning'}
                                </span>
                            </div>
                            <div>
                                <h4 className="text-2xl font-bold text-[#10193f]">
                                    {result.imported > 0 ? 'Import Complete' : 'Import Finished'}
                                </h4>
                                <p className="mt-1 text-[#8b95ad] text-sm">
                                    {typeof result.totalRows === 'number'
                                        ? `Processed ${result.totalRows} row${result.totalRows === 1 ? '' : 's'} from your file.`
                                        : 'Your records have been processed.'}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-5 bg-[#f8fafc] rounded-[24px] border border-[#f1f5f9]">
                                    <div className="text-3xl font-black text-[#1f52cc]">{result.imported ?? 0}</div>
                                    <div className="text-[10px] font-bold text-[#8b95ad] uppercase tracking-widest mt-1">Imported</div>
                                </div>
                                <div className="p-5 bg-[#f8fafc] rounded-[24px] border border-[#f1f5f9]">
                                    <div className="text-3xl font-black text-[#8b95ad]">{result.skipped ?? 0}</div>
                                    <div className="text-[10px] font-bold text-[#8b95ad] uppercase tracking-widest mt-1">Skipped</div>
                                </div>
                            </div>

                            {result.errors?.length > 0 && (
                                <div className="max-h-40 overflow-y-auto text-left space-y-2 p-4 bg-red-50/30 rounded-2xl border border-red-50">
                                    <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">Row Issues</div>
                                    {result.errors.slice(0, 8).map((err, i) => (
                                        <div key={i} className="text-[11px] text-red-600 bg-white/50 p-2 rounded-lg border border-red-50">
                                            <span className="font-bold">Row {err.row}:</span> {err.error}
                                        </div>
                                    ))}
                                    {result.errors.length > 8 && (
                                        <div className="text-[10px] text-center text-red-400 font-bold">
                                            +{result.errors.length - 8} more
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={handleClose}
                                className="os-btn-primary w-full h-12 rounded-2xl font-bold mt-4"
                            >
                                OK
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BulkImportModal;
