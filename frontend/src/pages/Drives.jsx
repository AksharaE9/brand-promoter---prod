import React, { useState } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import { lazyWithRetry } from '../lib/lazyWithRetry';
// Lazy load drive campaign workspace to optimize Campaigns page bundle size
const CollegeDriveWorkspace = lazyWithRetry(() => import('../components/CollegeDriveWorkspace'), 'CollegeDriveWorkspace');
import { enterpriseFooterLinks, enterpriseNavItems } from '../config/enterpriseNav';

const Drives = () => {
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');

  return (
    <EnterpriseLayout
      sidebar={<EnterpriseSidebar active="drives" items={enterpriseNavItems} footerLinks={enterpriseFooterLinks} />}
      topbar={
        <EnterpriseTopbar
          searchPlaceholder="Search drives..."
          right={<><NotificationBell /><UserChip avatarSeed="drives-user" /></>}
        />
      }
    >
      <PageEnter className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="os-eyebrow">Recruitment Campaigns</div>
            <h1 className="os-h1">Hiring Drives</h1>
          </div>
        </div>

        {error && <div className="os-card p-4 text-red-600 text-sm mb-4">{error}</div>}
        {banner && <div className="os-card p-4 text-[#2454cf] text-sm mb-4">{banner}</div>}

        <Reveal>
          <div className="bg-white rounded-3xl border border-[#e4ebf1] p-2 min-h-[70vh]">
            <React.Suspense fallback={<div className="p-8 text-center text-slate-400">Loading campaign workspace...</div>}>
              <CollegeDriveWorkspace onBanner={setBanner} onError={setError} />
            </React.Suspense>
          </div>
        </Reveal>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Drives;
