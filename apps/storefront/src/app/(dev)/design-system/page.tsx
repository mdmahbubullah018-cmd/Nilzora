import { colors } from '@nilzora/design-tokens';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Logo,
  LogoMark,
  NativeSelect,
  PageHeader,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  type BadgeTone,
  type ButtonVariant,
} from '@nilzora/ui';
import { Inbox, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DialogPreview } from '@/components/dev/dialog-preview';

export const metadata: Metadata = { title: 'Design system' };

const buttonVariants: ButtonVariant[] = [
  'primary',
  'secondary',
  'outline',
  'ghost',
  'danger',
  'link',
];
const badgeTones: BadgeTone[] = [
  'neutral',
  'primary',
  'success',
  'warning',
  'danger',
  'violet',
  'moderator',
  'offer',
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border pt-8">
      <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={<Badge tone="warning">Development only</Badge>}
        title="Nilzora design system"
        description="Shared primitives from @nilzora/ui and tokens from @nilzora/design-tokens. This page is not available in production builds."
      />

      <Section title="Brand">
        <Alert tone="warning" title="Placeholder logo">
          The official SVG artwork has not been supplied. These marks are typographic stand-ins and
          will be replaced by the files placed in assets/brand.
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-border p-6">
            <Logo size="lg" />
            <LogoMark size="lg" />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-brand-navy p-6">
            <Logo size="lg" tone="dark" />
            <LogoMark size="lg" tone="dark" />
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Object.entries(colors).map(([name, value]) => (
            <li key={name} className="overflow-hidden rounded-lg border border-border">
              <span aria-hidden="true" className="block h-14" style={{ backgroundColor: value }} />
              <span className="block px-3 py-2 text-xs">
                <span className="block font-semibold text-foreground">{name}</span>
                {value}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <div className="grid gap-3">
          <p className="font-display text-4xl font-semibold tracking-tight text-foreground">
            Display — Poppins SemiBold
          </p>
          <p className="font-display text-2xl font-semibold text-foreground">Section heading</p>
          <p className="text-base leading-relaxed">
            Body text uses Inter for clear, readable interface copy across product pages, forms and
            dashboards.
          </p>
          <p className="text-sm text-muted-foreground">Secondary text for hints and metadata.</p>
          <div className="grid gap-1 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Bengali fallback (Noto Sans Bengali)
            </p>
            <p lang="bn" className="font-display text-2xl font-semibold text-foreground">
              বাংলা টাইপোগ্রাফি — ক্যাশ অন ডেলিভারি
            </p>
            <p lang="bn" className="text-base leading-relaxed">
              পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন। Mixed text: অর্ডার #1024 confirmed.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          {buttonVariants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant[0]?.toUpperCase()}
              {variant.slice(1)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="outline" aria-label="Add">
            <Plus aria-hidden="true" />
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          {badgeTones.map((tone) => (
            <Badge key={tone} tone={tone} dot={tone !== 'offer'}>
              {tone === 'offer' ? '−20%' : tone}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Form fields">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="ds-name" label="Full name" required>
            {(control) => <Input {...control} autoComplete="name" />}
          </Field>
          <Field
            id="ds-phone"
            label="Mobile number"
            hint="Used by the courier to reach you."
            error="Enter a valid Bangladeshi mobile number"
          >
            {(control) => <Input {...control} type="tel" defaultValue="0171234" />}
          </Field>
          <Field id="ds-division" label="Division">
            {(control) => (
              <NativeSelect {...control} defaultValue="dhaka">
                <option value="dhaka">Dhaka</option>
                <option value="chattogram">Chattogram</option>
              </NativeSelect>
            )}
          </Field>
          <Field id="ds-disabled" label="Disabled">
            {(control) => <Input {...control} disabled placeholder="Not editable" />}
          </Field>
          <Field id="ds-notes" label="Delivery notes" className="sm:col-span-2">
            {(control) => <Textarea {...control} placeholder="Landmark, preferred time…" />}
          </Field>
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Supporting description text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">Cards group related content on white surfaces.</p>
            </CardContent>
            <CardFooter>
              <Button size="sm">Primary action</Button>
              <Button size="sm" variant="ghost">
                Secondary
              </Button>
            </CardFooter>
          </Card>
          <Card>
            <EmptyState
              icon={Inbox}
              title="Nothing here yet"
              description="Empty states explain what will appear and why."
            />
          </Card>
        </div>
      </Section>

      <Section title="Feedback">
        <div className="grid gap-3 md:grid-cols-2">
          <Alert tone="info" title="Information">
            Neutral guidance for the current page.
          </Alert>
          <Alert tone="success" title="Saved">
            Changes were stored successfully.
          </Alert>
          <Alert tone="warning" title="Low stock">
            Only a few items remain.
          </Alert>
          <Alert tone="danger" title="Something went wrong">
            Errors are announced to screen readers immediately.
          </Alert>
        </div>
        <div className="flex items-center gap-6">
          <Spinner />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </Section>

      <Section title="Dialogs">
        <DialogPreview />
      </Section>

      <Section title="Table">
        <Card className="overflow-hidden">
          <Table>
            <TableCaption className="pb-4">Sample data for this preview only.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-mono text-xs">SAMPLE-001</TableCell>
                <TableCell>Sample product A</TableCell>
                <TableCell>
                  <Badge tone="success" dot>
                    Active
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">24</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">SAMPLE-002</TableCell>
                <TableCell>Sample product B</TableCell>
                <TableCell>
                  <Badge tone="warning" dot>
                    Low stock
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">3</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </Section>
    </main>
  );
}
