import React, { useState } from 'react';
import { validateUploadFile } from '../../lib/fileValidation';

export function ContactAttemptPopover({ attemptType, label, onSubmit, onCancel, submitting }) {
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await validateUploadFile(file, 'followUp');
    if (!res.valid) {
      alert(res.error);
      e.target.value = '';
      return;
    }
    setUploadingPhoto(true);
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoUrl(reader.result);
        setUploadingPhoto(false);
      };
      reader.readAsDataURL(file);
    } catch (_) {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ photoUrl, note });
  };

  return (
    <div className="fixed inset-0 z-[2500] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-100 overflow-hidden relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-600 text-lg">
              {attemptType === 'DIDNT_PICK_UP' ? 'phone_missed' : 'wb_sunny'}
            </span>
            <h4 className="font-bold text-slate-800 text-sm">Log Attempt: {label}</h4>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 rounded-full p-1 transition-colors"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Proof Photo / Screenshot <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition-colors"
            />
            {uploadingPhoto && <p className="text-[10px] text-slate-400 mt-1">Processing image...</p>}
            {photoUrl && !uploadingPhoto && (
              <div className="mt-1 text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">check_circle</span> Photo attached
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Note / Remark <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Called candidate twice, line busy."
              className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700 placeholder:text-slate-400 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || uploadingPhoto}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs"
            >
              {submitting ? 'Saving...' : 'Log Attempt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
