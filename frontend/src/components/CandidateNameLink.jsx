import * as React from 'react';
import { Link } from 'react-router-dom';
import { TruncatedText } from './TruncatedText';

export const CandidateNameLink = React.memo(function CandidateNameLink({
  candidateId,
  candidateName,
  name,
  interviewId,
  className = '',
  type = 'candidate', // 'candidate' | 'member'
  variant = 'profile', // 'profile' | 'activity' | 'interview'
  onClick,
}) {
  if (!candidateId) return <TruncatedText text={candidateName || name || 'Deleted Candidate'} />;

  // Decide if we should apply the default link color or let the parent color class flow down
  const hasCustomColor = className.includes('text-');
  const colorClass = hasCustomColor ? '' : 'text-[#1f52cc] hover:text-[#163fa3]';

  const displayName = candidateName || name;

  if (variant === 'activity') {
    return (
      <TruncatedText
        as="span"
        text={displayName || (type === 'member' ? 'Member' : 'Candidate')}
        className={`underline decoration-transparent hover:decoration-current transition-all font-bold cursor-pointer ${colorClass} ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          if (onClick) onClick(e);
        }}
      />
    );
  }

  const toPath = variant === 'interview'
    ? `/schedule?interviewId=${interviewId}`
    : type === 'member'
      ? `/scheduling/members/${candidateId}`
      : `/candidates/${candidateId}`;

  return (
    <TruncatedText
      as={Link}
      to={toPath}
      text={displayName || (type === 'member' ? 'Member' : 'Candidate')}
      className={`underline decoration-transparent hover:decoration-current transition-all font-bold ${colorClass} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick(e);
      }}
    />
  );
});

