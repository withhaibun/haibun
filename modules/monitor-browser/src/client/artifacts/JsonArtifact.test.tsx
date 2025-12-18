/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonArtifact } from './JsonArtifact';

describe('JsonArtifact', () => {
  const testData = {
    id: 'test-id',
    timestamp: Date.now(),
    source: 'test',
    level: 'info' as const,
    kind: 'artifact' as const,
    artifactType: 'json' as const,
    json: {
      nested: { a: 1 }
    },
    mimetype: 'application/json'
  };

  it('toggles open/close state', async () => {
    render(<JsonArtifact artifact={testData} />);
    
    const nestedSummary = screen.getByText(/"nested"/);
    const details = nestedSummary.closest('details');
    expect(details).toHaveAttribute('open');
    
    fireEvent.click(nestedSummary);
    expect(details).not.toHaveAttribute('open');
    
    fireEvent.click(nestedSummary);
    expect(details).toHaveAttribute('open');
  });
});
