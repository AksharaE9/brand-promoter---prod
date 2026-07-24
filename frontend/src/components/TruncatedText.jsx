import React, { forwardRef } from 'react';

export const TruncatedText = forwardRef(
  ({ text, className = '', as: Component = 'span', ...rest }, ref) => {
    return (
      <Component
        ref={ref}
        className={`truncated-text ${className}`}
        title={text}
        data-fulltext={text}
        {...rest}
      >
        {text}
      </Component>
    );
  }
);

TruncatedText.displayName = 'TruncatedText';

export default TruncatedText;
