import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../ui/App';

describe('App (smoke test)', () => {
  it('renders the Pijon heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /pijon/i })).toBeInTheDocument();
  });
});
