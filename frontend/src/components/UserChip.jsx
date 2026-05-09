import React from 'react';
import { getStoredUser } from '../lib/api';

const UserChip = ({ fallbackName = 'User', fallbackRole = 'Team Member', avatarSeed = 'default-user' }) => {
  const user = getStoredUser();
  const name = user?.fullName || fallbackName;
  const role = user?.role ? String(user.role).replace('_', ' ') : fallbackRole;
  const avatarKey = user?.id || avatarSeed;

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="os-user-chip">
      {user?.profilePhotoUrl ? (
        <img className="os-avatar" src={user.profilePhotoUrl} alt={name} />
      ) : (
        <div className="os-avatar bg-[#1f52cc] text-white flex items-center justify-center font-bold text-sm">
          {initials}
        </div>
      )}
    </div>
  );
};

export default UserChip;
