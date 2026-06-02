import React, { useState } from 'react';

/**
 * Optimized Avatar component with initials fallback.
 * - Lazy loads images
 * - Falls back to color-coded initials on error
 * - No layout shift on load
 *
 * @param {{ name: string, photoUrl?: string, size?: number, style?: object }} props
 */
const Avatar = React.memo(function Avatar({ name, photoUrl, size = 36, style: extraStyle }) {
  const [imgError, setImgError] = useState(false);

  const initials = name
    ?.split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  const colors = [
    '#1F3864', '#2E86AB', '#A23B72', '#F18F01',
    '#C73E1D', '#3B1F2B', '#0E7C7B', '#17BEBB',
  ];
  const colorIndex = name ? name.charCodeAt(0) % colors.length : 0;

  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={name || 'Avatar'}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setImgError(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          ...extraStyle,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colors[colorIndex],
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.35,
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
        ...extraStyle,
      }}
      title={name}
    >
      {initials}
    </div>
  );
});

export default Avatar;
