import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

const EditInterviewModal = ({ isOpen, onClose, interviewId, onUpdate }) => {
  const [formData, setFormData] = useState({});
  const [originalData, setOriginalData] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [interviewers, setInterviewers] = useState([]);
  const [interviewerSearch, setInterviewerSearch] = useState('');
  
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen && interviewId) {
      fetchInterview();
      fetchInterviewers();
    }
  }, [isOpen, interviewId]);

  const fetchInterviewers = async () => {
    try {
      const { data } = await api.get('/users/interviewers');
      setInterviewers(data.data || []);
    } catch (err) {
      console.error('Failed to load interviewers:', err);
    }
  };

  const fetchInterview = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get(`/interviews/${interviewId}`);
      const dateObj = data.data.scheduledStart ? new Date(data.data.scheduledStart) : new Date();
      const scheduledDate = !isNaN(dateObj.getTime()) ? dateObj.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const scheduledTime = !isNaN(dateObj.getTime()) ? dateObj.toTimeString().substring(0, 5) : '10:00';
      
      const initial = {
        roundName: data.data.round || `Round ${data.data.roundNo}`,
        scheduledDate,
        scheduledTime,
        durationMinutes: data.data.durationMinutes || 60,
        mode: data.data.mode || 'ONLINE',
        meetingLink: data.data.meetingLink || '',
        zohoLink: data.data.zohoLink || '',
        venue: data.data.venue || '',
        interviewerIds: data.data.interviewerIds || [],
        rescheduleReason: '',
        instructions: data.data.instructions || '',
        internalNotes: data.data.internalNotes || ''
      };
      setFormData(initial);
      setOriginalData(initial);
    } catch (err) {
      setError('Failed to load interview details.');
    } finally {
      setIsLoading(false);
    }
  };

  const hasChanged = (field) => {
    if (Array.isArray(formData[field])) {
      if (formData[field].length !== originalData[field]?.length) return true;
      return !formData[field].every(val => originalData[field]?.includes(val));
    }
    return formData[field] !== originalData[field];
  };
  
  const anyChanged = useMemo(() => {
    return Object.keys(originalData).some(key => {
      if (key === 'rescheduleReason') return false;
      return hasChanged(key);
    });
  }, [formData, originalData]);

  const timeOrDateChanged = hasChanged('scheduledDate') || hasChanged('scheduledTime');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (rescheduleOnly = false) => {
    if (timeOrDateChanged && !formData.rescheduleReason) {
      setError("Reason for rescheduling is required.");
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      if (!formData.scheduledDate || !formData.scheduledTime) {
        setError("Scheduled date and time are required.");
        setIsSaving(false);
        return;
      }
      const [year, month, day] = formData.scheduledDate.split('-').map(Number);
      const [hours, minutes] = formData.scheduledTime.split(':').map(Number);
      const scheduledStart = new Date(year, month - 1, day, hours, minutes).toISOString();
      
      const payload = {
        ...formData,
        round: formData.roundName, // MAP roundName to round
        scheduledStart
      };

      if (rescheduleOnly) {
        await api.patch(`/interviews/${interviewId}/reschedule`, {
          scheduledStart,
          mode: formData.mode,
          rescheduleReason: formData.rescheduleReason
        });
        
        try {
          await api.post('/notifications', {
            title: 'Interview Rescheduled',
            message: `Interview has been rescheduled to ${formData.scheduledDate} ${formData.scheduledTime}`,
            type: 'INFO'
          });
        } catch (notifErr) {
          console.error('Notification failed:', notifErr);
        }
      } else {
        await api.put(`/interviews/${interviewId}`, payload);
      }

      queryClient.invalidateQueries({ queryKey: ['scheduling'] });
      if (onUpdate) onUpdate();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to update interview.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[#0f1b3e]/60 backdrop-blur-[8px] modal-overlay-fade"
        onClick={onClose}
      />
      <div
        className="relative bg-white rounded-[24px] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 modal-scale-up"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">Edit Interview Round</h3>
          <button onClick={onClose} className="os-icon-btn"><span className="material-symbols-outlined">close</span></button>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-8"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
        ) : (
          <div className="space-y-4">
            {error && <div className="text-red-600 bg-red-50 p-3 rounded-lg text-sm">{error}</div>}
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Round Name {hasChanged('roundName') && <span className="w-2 h-2 rounded-full bg-blue-500"/>}</label>
                <input type="text" name="roundName" value={formData.roundName} onChange={handleChange} className="w-full os-input" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Mode {hasChanged('mode') && <span className="w-2 h-2 rounded-full bg-blue-500"/>}</label>
                <select name="mode" value={formData.mode} onChange={handleChange} className="w-full os-input">
                  <option value="ONLINE">Online Meeting</option>
                  <option value="VIRTUAL">Virtual</option>
                  <option value="IN_PERSON">In Person</option>
                  <option value="PHONE">Phone Call</option>
                  <option value="DRIVE">Drive Meeting</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Scheduled Date {hasChanged('scheduledDate') && <span className="w-2 h-2 rounded-full bg-blue-500"/>}</label>
                <input type="date" name="scheduledDate" value={formData.scheduledDate} onChange={handleChange} className="w-full os-input" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Scheduled Time {hasChanged('scheduledTime') && <span className="w-2 h-2 rounded-full bg-blue-500"/>}</label>
                <input type="time" name="scheduledTime" value={formData.scheduledTime} onChange={handleChange} className="w-full os-input" />
              </div>
            </div>

            {(formData.mode === 'VIRTUAL' || formData.mode === 'ONLINE') && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Meeting Link {hasChanged('meetingLink') && <span className="w-2 h-2 rounded-full bg-blue-500"/>}</label>
                  <input type="url" name="meetingLink" value={formData.meetingLink} onChange={handleChange} className="w-full os-input" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Zoho Link {hasChanged('zohoLink') && <span className="w-2 h-2 rounded-full bg-blue-500"/>}</label>
                  <input type="url" name="zohoLink" value={formData.zohoLink} onChange={handleChange} className="w-full os-input" />
                </div>
              </div>
            )}
            
            {formData.mode === 'IN_PERSON' && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Venue {hasChanged('venue') && <span className="w-2 h-2 rounded-full bg-blue-500"/>}</label>
                <input type="text" name="venue" value={formData.venue} onChange={handleChange} className="w-full os-input" />
              </div>
            )}

            {/* Interviewer checklist */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-500">Interviewers (Multiple) {hasChanged('interviewerIds') && <span className="w-2 h-2 rounded-full bg-blue-500 inline-block ml-1"/>}</label>
                <input 
                  className="text-xs border-b border-slate-200 focus:border-blue-400 outline-none w-28 animate-none"
                  placeholder="Filter..."
                  value={interviewerSearch}
                  onChange={(e) => setInterviewerSearch(e.target.value)}
                />
              </div>
              <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50 custom-scrollbar">
                {interviewers
                  .filter(p => p.fullName.toLowerCase().includes(interviewerSearch.toLowerCase()))
                  .map((person) => (
                  <label key={person.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded-lg transition-colors">
                    <input
                      type="checkbox"
                      checked={formData.interviewerIds?.includes(person.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...formData.interviewerIds, person.id]
                          : formData.interviewerIds.filter(id => id !== person.id);
                        setFormData(prev => ({ ...prev, interviewerIds: ids }));
                      }}
                      className="rounded-md h-4 w-4 text-[#1f52cc] border-slate-300 focus:ring-[#1f52cc]"
                    />
                    <span className="text-sm font-medium text-slate-700">{person.fullName} <span className="text-[10px] text-slate-400 font-normal">({person.role})</span></span>
                  </label>
                ))}
              </div>
            </div>

            {timeOrDateChanged && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
                <label className="text-xs font-bold text-amber-700 mb-1 block">Reason for Rescheduling <span className="text-red-500">*</span></label>
                <input type="text" name="rescheduleReason" value={formData.rescheduleReason} onChange={handleChange} className="w-full os-input border-amber-200 focus:border-amber-400 focus:ring-amber-400" required />
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
              {timeOrDateChanged && (
                <button onClick={() => handleSave(true)} disabled={isSaving || !formData.rescheduleReason} className="px-4 py-2 text-sm font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50">
                  {isSaving ? 'Saving...' : 'Reschedule Only'}
                </button>
              )}
              <button onClick={() => handleSave(false)} disabled={isSaving || !anyChanged || (timeOrDateChanged && !formData.rescheduleReason)} className="px-6 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-md disabled:opacity-50 shadow-blue-500/30">
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(EditInterviewModal);
