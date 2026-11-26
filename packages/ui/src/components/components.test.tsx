import { fireEvent, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { cn } from '../lib/cn';
import { Alert } from './alert';
import { Badge } from './badge';
import { Button, buttonClasses } from './button';
import { Dialog } from './dialog';
import { EmptyState } from './empty-state';
import { Field } from './field';
import { Input } from './input';
import { Logo, LogoMark } from './logo';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

describe('cn', () => {
  it('lets later Tailwind utilities win over conflicting earlier ones', () => {
    expect(cn('px-4 bg-primary', 'px-2', false, 'bg-surface')).toBe('px-2 bg-surface');
  });
});

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('type', 'button');
  });

  it('blocks interaction and reports progress while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Place order
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Place order' });

    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes the same styles for links via buttonClasses', () => {
    expect(buttonClasses({ variant: 'outline', size: 'sm' })).toContain('border-border-strong');
    expect(buttonClasses({ variant: 'link' })).not.toContain('h-10');
  });
});

describe('Field', () => {
  it('labels the control and links its hint and error', () => {
    render(
      <Field
        id="phone"
        label="Mobile number"
        hint="We call before delivery"
        error="Required"
        required
      >
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Mobile number/);

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('phone-hint phone-error');
    expect(input).toHaveProperty('required', true);
    expect(screen.getByText('Required').id).toBe('phone-error');
  });

  it('leaves the control valid when there is no error', () => {
    render(
      <Field id="name" label="Name">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Name');

    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('feedback', () => {
  it('announces errors assertively and other alerts politely', () => {
    render(
      <>
        <Alert tone="danger" title="Payment failed" />
        <Alert tone="success" title="Saved" />
      </>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Payment failed');
    expect(screen.getByRole('status').textContent).toContain('Saved');
  });

  it('renders an empty state with its action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No orders yet"
        description="Orders appear here."
        action={<Button>Refresh</Button>}
      />,
    );
    expect(screen.getByText('No orders yet')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDefined();
  });

  it('hides the decorative badge dot from assistive technology', () => {
    const { container } = render(
      <Badge tone="success" dot>
        Active
      </Badge>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Active')).toBeDefined();
  });
});

describe('Logo', () => {
  it('announces the brand name once', () => {
    render(<Logo />);
    const logo = screen.getByRole('img', { name: 'Nilzora' });
    expect(logo.className).toContain('nz-brand-logo');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('stays silent when a surrounding link already names the store', () => {
    render(<Logo decorative />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('pins the navy-surface artwork only when asked to', () => {
    const { rerender } = render(<Logo />);
    // No data-tone: the tone follows [data-theme], which is how dark mode switches the artwork
    // without JavaScript and without downloading both files.
    expect(screen.getByRole('img').hasAttribute('data-tone')).toBe(false);
    rerender(<Logo tone="dark" />);
    expect(screen.getByRole('img').getAttribute('data-tone')).toBe('dark');
    rerender(<Logo tone="light" />);
    expect(screen.getByRole('img').getAttribute('data-tone')).toBe('light');
  });

  it('keeps the supplied artwork aspect ratio at every size', () => {
    for (const [size, height] of [
      ['sm', 28],
      ['md', 36],
      ['lg', 48],
    ] as const) {
      const { unmount } = render(<Logo size={size} />);
      const logo = screen.getByRole('img');
      expect(logo.style.height).toBe(`${height}px`);
      const width = Number.parseFloat(logo.style.width);
      expect(width / height).toBeCloseTo(1023 / 243, 2);
      unmount();
    }
  });

  it('gives a standalone mark an accessible name and the official artwork class', () => {
    render(<LogoMark />);
    const mark = screen.getByRole('img', { name: 'Nilzora' });
    expect(mark.className).toContain('nz-brand-mark');
    expect(mark.hasAttribute('data-brand-placeholder')).toBe(false);
  });
});

describe('Table', () => {
  it('scopes header cells to their columns', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>NZ-001</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: 'SKU' }).getAttribute('scope')).toBe('col');
  });
});

describe('Dialog', () => {
  function renderDialog(open: boolean, onOpenChange = vi.fn()) {
    const utils = render(
      <Dialog open={open} onOpenChange={onOpenChange} title="Cancel order" description="Confirm">
        <p>Body</p>
      </Dialog>,
    );
    const dialog = utils.container.querySelector('dialog');
    if (!dialog) throw new Error('dialog element not rendered');
    return { ...utils, dialog, onOpenChange };
  }

  it('opens as a modal labelled by its title and description', () => {
    const { dialog } = renderDialog(true);

    expect(dialog.open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Cancel order' })).toBe(dialog);
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('Confirm').id);
  });

  it('closes through the controlled state when Escape cancels it', () => {
    const { dialog, onOpenChange } = renderDialog(true);
    const cancel = new Event('cancel', { cancelable: true });

    dialog.dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on backdrop clicks and the close button, but not on clicks inside', () => {
    const { dialog, onOpenChange } = renderDialog(true);

    fireEvent.click(screen.getByText('Body'));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('closes the native dialog when the open prop becomes false', () => {
    const onOpenChange = vi.fn();
    const { dialog, rerender } = renderDialog(true, onOpenChange);

    rerender(
      <Dialog open={false} onOpenChange={onOpenChange} title="Cancel order" description="Confirm">
        <p>Body</p>
      </Dialog>,
    );
    expect(dialog.open).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
