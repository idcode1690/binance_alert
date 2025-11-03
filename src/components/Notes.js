import React from 'react';
import PropTypes from 'prop-types';

export default function Notes({ children }) {
  return (
    <div className="note">{children}</div>
  );
}

Notes.propTypes = {
  children: PropTypes.node,
};
