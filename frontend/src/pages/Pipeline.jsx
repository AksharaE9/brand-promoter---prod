// Pipeline page has been removed.
// Any /pipeline links redirect automatically to /candidates.
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const Pipeline = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const jobId = params.get('jobId');
  useEffect(() => {
    // Redirect old pipeline links to candidates, preserving job context
    navigate(jobId ? `/jobs/${jobId}` : '/candidates', { replace: true });
  }, []);
  return null;
};

export default Pipeline;
