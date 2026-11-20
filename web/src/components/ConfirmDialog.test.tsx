import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmButton } from './ConfirmDialog';
afterEach(cleanup);

describe('ConfirmButton / ConfirmDialog', () => {
  it('opens a labelled alertdialog, Escape cancels without confirming and focus returns', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Archive" title="Archive Maths?" body={<p>Hidden from lists.</p>} onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Archive' }); trigger.focus(); fireEvent.click(trigger);
    const dlg = screen.getByRole('alertdialog', { name: 'Archive Maths?' });
    expect(dlg).toHaveAttribute('aria-modal', 'true'); expect(dlg).toHaveAccessibleDescription('Hidden from lists.');
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('type-to-confirm keeps the action disabled until the exact text is typed', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmButton label="Delete" title="Delete school?" body="x" typeToConfirm="ACC-01" confirmLabel="Delete school" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const go = screen.getByRole('button', { name: 'Delete school' }); expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type ACC-01 to confirm/), { target: { value: 'ACC-0' } }); expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type ACC-01 to confirm/), { target: { value: 'ACC-01' } }); expect(go).toBeEnabled();
    fireEvent.click(go); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(onConfirm).toHaveBeenCalledOnce();
  });
  it('a failing action keeps the dialog open and shows the server message', async () => {
    render(<ConfirmButton label="Delete" title="Delete level?" body="x" onConfirm={() => Promise.reject(new Error('Still in use by 3 subjects'))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    expect(await screen.findByText('Still in use by 3 subjects')).toBeInTheDocument(); expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
