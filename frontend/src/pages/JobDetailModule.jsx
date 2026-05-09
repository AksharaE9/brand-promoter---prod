import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { apiGet, apiPost, apiDelete, getStoredUser } from '../lib/api';
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const TABS = [
  { id: 'JD', label: 'JD' },
  { id: 'POSTERS_AND_BROCHURE', label: 'Posters & Brochure' },
  { id: 'INTERVIEW_QUESTIONS', label: 'Interview Questions' },
  { id: 'SOP', label: 'SOP' }
];

const JobDetailModule = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('JD');
  const [job, setJob] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form states
  const [docLink, setDocLink] = useState('');
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState('TECHNICAL');
  const [qSkill, setQSkill] = useState('');

  const currentUser = getStoredUser();

  const loadData = async () => {
    try {
      setLoading(true);
      const [jobRes, docsRes, questionsRes] = await Promise.all([
        apiGet(`/jobs`), // Workaround: find the job from all jobs since we don't have a single job endpoint
        apiGet(`/jobs/${id}/documents`),
        apiGet(`/jobs/${id}/questions`)
      ]);
      const currentJob = jobRes.data.find(j => j.id === id);
      setJob(currentJob);
      setDocuments(docsRes.data || []);
      setQuestions(questionsRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleAddDocument = async (e) => {
    e.preventDefault();
    if (!docLink.trim()) return;
    try {
      await apiPost(`/jobs/${id}/documents`, { type: activeTab, googleDriveLink: docLink });
      setDocLink('');
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to add document');
    }
  };

  const handleDeleteDocument = async (docId) => {
    if (!window.confirm("Are you sure?")) return;
    try {
      await apiDelete(`/jobs/${id}/documents/${docId}`);
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  };

  const handleAddQuestion = async (e) => {
    e.preventDefault();
    if (!qText.trim()) return;
    try {
      await apiPost(`/jobs/${id}/questions`, { question: qText, competency: qType, difficulty: qSkill });
      setQText('');
      setQSkill('');
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to add question');
    }
  };

  const handleDeleteQuestion = async (qId) => {
    if (!window.confirm("Are you sure?")) return;
    try {
      await apiDelete(`/jobs/${id}/questions/${qId}`);
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  };

  const renderTabContent = () => {
    const currentDocs = documents.filter(d => d.type === activeTab);

    if (activeTab === 'INTERVIEW_QUESTIONS') {
      return (
        <div className="space-y-8">
          {/* Link Section for Interview Questions */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold text-[#1f2937] flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">link</span>
              Interview Question Links
            </h3>
            <form onSubmit={handleAddDocument} className="os-card p-4 flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-xs uppercase text-[#7b86a0] tracking-wider mb-1 block">Google Drive Link</label>
                <input type="url" value={docLink} onChange={e => setDocLink(e.target.value)} className="w-full h-10 px-3 border border-[#dbe4ee] rounded-lg" placeholder="https://docs.google.com/..." required />
              </div>
              <button type="submit" className="os-btn-primary !h-10">Add Link</button>
            </form>

            <div className="grid gap-3">
              {currentDocs.map(doc => (
                <div key={doc.id} className="os-card p-4 flex justify-between items-center group">
                  <a href={doc.googleDriveLink} target="_blank" rel="noreferrer" className="text-[#1f52cc] hover:underline font-medium text-sm flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg">link</span>
                    {doc.googleDriveLink}
                  </a>
                  <button onClick={() => handleDeleteDocument(doc.id)} className="os-icon-btn !text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              ))}
              {currentDocs.length === 0 && <div className="text-[#7b86a0] text-sm py-4 text-center">No question links added yet.</div>}
            </div>
          </section>

          <hr className="border-[#dbe4ee]" />

          {/* Individual Questions Section */}
          <section className="space-y-4">
            <h3 className="text-sm font-bold text-[#1f2937] flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">quiz</span>
              Specific Interview Questions
            </h3>
            <form onSubmit={handleAddQuestion} className="os-card p-4 flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-xs uppercase text-[#7b86a0] tracking-wider mb-1 block">Question</label>
                <input type="text" value={qText} onChange={e => setQText(e.target.value)} className="w-full h-10 px-3 border border-[#dbe4ee] rounded-lg" placeholder="E.g., What is React?" required />
              </div>
              <div>
                <label className="text-xs uppercase text-[#7b86a0] tracking-wider mb-1 block">Category</label>
                <select value={qType} onChange={e => setQType(e.target.value)} className="h-10 px-3 border border-[#dbe4ee] rounded-lg">
                  <option value="TECHNICAL">Technical</option>
                  <option value="HR">HR</option>
                  <option value="CULTURE_FIT">Culture Fit</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase text-[#7b86a0] tracking-wider mb-1 block">Skill Tag</label>
                <input type="text" value={qSkill} onChange={e => setQSkill(e.target.value)} className="w-full h-10 px-3 border border-[#dbe4ee] rounded-lg" placeholder="React" />
              </div>
              <button type="submit" className="os-btn-primary !h-10">Add</button>
            </form>

            <div className="grid gap-3">
              {questions.map(q => (
                <div key={q.id} className="os-card p-4 flex justify-between items-center group">
                  <div>
                    <div className="font-semibold text-sm mb-1">{q.question}</div>
                    <div className="flex gap-2">
                      <span className="text-[10px] bg-[#eef1f6] px-2 py-0.5 rounded text-[#5c6881]">{q.competency}</span>
                      {q.difficulty && <span className="text-[10px] bg-[#eef1f6] px-2 py-0.5 rounded text-[#5c6881]">{q.difficulty}</span>}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteQuestion(q.id)} className="os-icon-btn !text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              ))}
              {questions.length === 0 && <div className="text-[#7b86a0] text-sm py-4 text-center">No individual questions added yet.</div>}
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <form onSubmit={handleAddDocument} className="os-card p-4 flex gap-4 items-end">
          <div className="flex-1">
            <label className="text-xs uppercase text-[#7b86a0] tracking-wider mb-1 block">Google Drive Link</label>
            <input type="url" value={docLink} onChange={e => setDocLink(e.target.value)} className="w-full h-10 px-3 border border-[#dbe4ee] rounded-lg" placeholder="https://docs.google.com/..." required />
          </div>
          <button type="submit" className="os-btn-primary !h-10">Add Link</button>
        </form>

        <div className="grid gap-3">
          {currentDocs.map(doc => (
            <div key={doc.id} className="os-card p-4 flex justify-between items-center group">
              <a href={doc.googleDriveLink} target="_blank" rel="noreferrer" className="text-[#1f52cc] hover:underline font-medium text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">link</span>
                {doc.googleDriveLink}
              </a>
              <button onClick={() => handleDeleteDocument(doc.id)} className="os-icon-btn !text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            </div>
          ))}
          {currentDocs.length === 0 && <div className="text-[#7b86a0] text-sm py-4 text-center">No links added yet.</div>}
        </div>
      </div>
    );
  };

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="jobs" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search docs..."
          tabs={[
            { key: 'details', label: 'Details', href: `/jobs/${id}`, active: true },
            { key: 'details', label: 'Details', href: `/jobs/${id}`, active: true }
          ]}
          right={<><NotificationBell /><UserChip /></>}
        />
      }
    >
      <PageEnter>
        {loading ? <div className="text-center p-10 text-[#6b7895]">Loading...</div> : (
          <>
            <button onClick={() => navigate('/jobs')} className="text-sm text-[#1f52cc] flex items-center gap-1 mb-4 hover:underline">
              <span className="material-symbols-outlined text-sm">arrow_back</span> Back to Jobs
            </button>
            <div className="mb-6">
              <h1 className="os-h1">{job?.title || 'Job Documents'}</h1>
              <div className="text-[#6b7690] mt-1">{job?.department} • {job?.location}</div>
            </div>

            <div className="flex gap-2 border-b border-[#dbe4ee] mb-6">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === tab.id ? 'border-[#1f52cc] text-[#1f52cc]' : 'border-transparent text-[#6b7895] hover:text-[#1f52cc]'}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <Reveal>
              {renderTabContent()}
            </Reveal>
          </>
        )}
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default JobDetailModule;
