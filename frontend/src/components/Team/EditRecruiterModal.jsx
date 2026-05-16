import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';

const EditRecruiterModal = ({ isOpen, onClose, userId, onUpdate }) => {
  const [formData, setFormData] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && userId) {
      fetchData();
    }
  }, [isOpen, userId]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get(`/team/recruiters/${userId}`);
      setFormData(data.data || {});
    } catch (err) {
      setError('Failed to load profile.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    try {
      await api.put(`/team/recruiters/${userId}`, formData);
      if (onUpdate) onUpdate();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl p-6"
        >
          <h3 className="text-xl font-bold mb-6">Edit Recruiter Profile</h3>
          
          {isLoading ? (
            <div className="flex justify-center p-8"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
          ) : (
            <div className="space-y-4">
              {error && <div className="text-red-600 bg-red-50 p-3 rounded-lg text-sm">{error}</div>}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Full Name</label>
                  <input type="text" name="fullName" value={formData.fullName || ''} onChange={handleChange} className="w-full os-input" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Work Email</label>
                  <input type="email" name="email" value={formData.email || ''} onChange={handleChange} className="w-full os-input" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Work Phone</label>
                  <input type="text" name="phone" value={formData.phone || ''} onChange={handleChange} className="w-full os-input" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Department</label>
                  <input type="text" name="department" value={formData.department || ''} onChange={handleChange} className="w-full os-input" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Bio</label>
                  <textarea name="bio" value={formData.bio || ''} onChange={handleChange} className="w-full os-input" rows="3" maxLength="500"></textarea>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
                <button onClick={handleSave} disabled={isSaving} className="px-6 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default React.memo(EditRecruiterModal);
