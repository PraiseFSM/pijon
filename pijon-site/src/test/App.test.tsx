import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../ui/App';

describe('App (smoke test)', () => {
  it('renders the editor shell with the Furniture tool selected', () => {
    render(<App />);
    expect(screen.getByRole('tablist', { name: /editor tools/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /furniture/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
