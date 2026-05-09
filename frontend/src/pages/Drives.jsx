import React, { useState } from 'react';
import EnterpriseLayout, { EnterpriseSidebar, EnterpriseTopbar } from '../components/EnterpriseLayout';
import { PageEnter, Reveal } from '../components/PageMotion';
import UserChip from '../components/UserChip';
import NotificationBell from '../components/NotificationBell';
import CollegeDriveWorkspace from '../components/CollegeDriveWorkspace';
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
            <CollegeDriveWorkspace onBanner={setBanner} onError={setError} />
          </div>
        </Reveal>
      </PageEnter>
    </EnterpriseLayout>
  );
};

export default Drives;
