import React from 'react';

export default function Header({ title = 'Binance EMA Cross Alert' }) {
  return (
    <div className="header">
      <div className="title">{title}</div>
      <div className="header-right" />
    </div>
  );
}
