import React, { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';
import { usePaginatedList } from '../hooks/usePaginatedList';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { getStoredUser, buildApiUrl, downloadAuthenticatedFile } from '../lib/api';
import { validateUploadFile } from '../lib/fileValidation';
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileArchive,
  File,
  Trash2,
  Download,
  CloudUpload,
  Loader2,
  AlertCircle
} from 'lucide-react';


const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const getFileIcon = (fileName) => {
  const ext = fileName.split('.').pop().toLowerCase();
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />;
  }
  if (['doc', 'docx', 'pdf', 'txt'].includes(ext)) {
    return <FileText className="w-5 h-5 text-blue-600 shrink-0" />;
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return <FileText className="w-5 h-5 text-orange-600 shrink-0" />;
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return <FileImage className="w-5 h-5 text-indigo-600 shrink-0" />;
  }
  if (['zip'].includes(ext)) {
    return <FileArchive className="w-5 h-5 text-amber-600 shrink-0" />;
  }
  return <File className="w-5 h-5 text-gray-500 shrink-0" />;
};

const Posted = () => {
  const queryClient = useQueryClient();
  const currentUser = useMemo(() => getStoredUser(), []);
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPER_ADMIN';

  const { addToast } = useToastStore();

  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // TanStack Infinite Query pagination via usePaginatedList
  const {
    data: pageData,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = usePaginatedList('/posted-files', {
    pageSize: 30,
    queryKey: ['posted-files']
  });

  // Flatten infinite query pages
  const files = useMemo(() => {
    if (!pageData?.pages) return [];
    return pageData.pages.flatMap((page) => page.data || []);
  }, [pageData]);

  // Client-side filtering by filename or uploader
  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const term = search.toLowerCase();
    return files.filter(
      (file) =>
        file.originalName.toLowerCase().includes(term) ||
        file.uploadedByName.toLowerCase().includes(term)
    );
  }, [files, search]);

  const handleUpload = useCallback(async (file) => {
    if (!file) return;
    
    const res = await validateUploadFile(file, 'posted');
    if (!res.valid) {
      setError(res.error);
      addToast({ type: 'error', message: res.error });
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      await api.post('/posted-files', formData);
      addToast({ type: 'success', message: `File uploaded successfully: ${file.name}` });
      queryClient.invalidateQueries({ queryKey: ['posted-files'] });
    } catch (err) {
      console.error('[PostedUpload] Upload error:', err);
      const errMsg = err.response?.data?.error?.message || err.message || 'Failed to upload file';
      setError(errMsg);
      addToast({ type: 'error', message: errMsg });
    } finally {
      setUploading(false);
    }
  }, [addToast, queryClient]);

  const handleDelete = useCallback(async (fileId, fileName) => {
    if (!window.confirm(`Are you sure you want to delete ${fileName}?`)) return;

    try {
      await api.delete(`/posted-files/${fileId}`);
      addToast({ type: 'warning', message: `File "${fileName}" deleted.` });
      queryClient.invalidateQueries({ queryKey: ['posted-files'] });
    } catch (err) {
      console.error('[PostedDelete] Delete error:', err);
      const errMsg = err.response?.data?.error?.message || err.message || 'Failed to delete file';
      addToast({ type: 'error', message: errMsg });
    }
  }, [addToast, queryClient]);

  const handleDownloadFile = useCallback(async (fileId, fileName) => {
    try {
      await downloadAuthenticatedFile(`/posted-files/${fileId}/download`, fileName);
    } catch (err) {
      console.error('[PostedDownload] Error downloading file:', err);
      const errMsg = err.message || "File wasn't available on site";
      addToast({ type: 'error', message: `${fileName} — ${errMsg}` });
    }
  }, [addToast]);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  }, [handleUpload]);

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="posted" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search files by name or uploader..."
          searchValue={search}
          onSearchChange={(e) => setSearch(e.target.value)}
          right={
            <>
              <NotificationBell />
              <UserChip fallbackName="System Administrator" fallbackRole="SUPER_ADMIN" avatarSeed="team-user" />
            </>
          }
        />
      }
    >
      <PageEnter>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="os-eyebrow">Shared File Storage</div>
            <h1 className="os-h1">Posted Files</h1>
          </div>
        </div>

        {/* Upload Card */}
        <Reveal delay={0.1}>
          <div className="os-card mt-6 p-6">
            <div
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all ${
                dragActive ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 hover:border-slate-300'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 mb-3">
                {uploading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <CloudUpload className="w-6 h-6" />
                )}
              </div>
              <p className="text-sm font-semibold text-slate-800 mb-1">
                {uploading ? 'Uploading your file...' : 'Drag & drop file here, or click to browse'}
              </p>
              <p className="text-xs text-slate-400">
                Excel, Word, PDF, PPT, Images, ZIP up to 50 MB
              </p>

              <input
                type="file"
                id="file-upload-input"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleUpload(e.target.files[0]);
                  }
                }}
              />
              <button
                type="button"
                className="os-btn-outline mt-4 h-9"
                onClick={() => document.getElementById('file-upload-input').click()}
                disabled={uploading}
              >
                Choose File
              </button>
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </Reveal>

        {/* File Table / List */}
        <Reveal delay={0.2}>
          <div className="os-card mt-6">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">
                All Shared Files ({filteredFiles.length})
              </h2>
            </div>

            {isLoading ? (
              <div className="p-12 flex justify-center items-center">
                <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
              </div>
            ) : isError ? (
              <div className="p-12 text-center text-slate-400 text-sm">
                Failed to load file list.
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-4xl text-slate-200">folder_open</span>
                <span>No files found matching filters.</span>
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold text-[#7c87a1] uppercase tracking-wider bg-slate-50/50">
                      <th className="py-3 px-4 font-semibold">Name</th>
                      <th className="py-3 px-4 font-semibold">Size</th>
                      <th className="py-3 px-4 font-semibold">Uploaded By</th>
                      <th className="py-3 px-4 font-semibold">Upload Date</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredFiles.map((file) => (
                      <tr key={file.id} className="hover:bg-slate-50/30 group">
                        <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2 max-w-xs md:max-w-md truncate">
                          {getFileIcon(file.originalName)}
                          <span className="truncate" title={file.originalName}>
                            {file.originalName}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {formatBytes(file.sizeBytes)}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {file.uploadedByName}
                        </td>
                        <td className="py-3 px-4 text-slate-400 text-xs">
                          {new Date(file.createdAt).toLocaleDateString()} at{' '}
                          {new Date(file.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDownloadFile(file.id, file.originalName)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Download File"
                            >
                              <Download className="w-4 h-4" />
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                onClick={() => handleDelete(file.id, file.originalName)}
                                title="Delete File"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Load More Button */}
            {hasNextPage && (
              <div className="p-4 border-t border-slate-100 flex justify-center">
                <button
                  type="button"
                  className="os-btn-outline h-9 flex items-center gap-2"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Load More Files'
                  )}
                </button>
              </div>
            )}
          </div>
        </Reveal>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Posted;
