import { Coins, Gavel, Timer, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Button, Clock, Money, Panel, Table, type TableColumn } from '../components/ui';
import { cssCustomProperties } from '@stakehouse/theme';
import './gallery.css';

interface StandingRow {
  manager: string;
  record: string;
  potShare: string;
}

const standingColumns: TableColumn<StandingRow>[] = [
  { key: 'manager', header: 'Manager' },
  { key: 'record', header: 'W-L', numeric: true },
  { key: 'potShare', header: 'Pot share', numeric: true },
];

// Fictional managers from the spec's draft-room copy — no real athletes here.
const standings: StandingRow[] = [
  { manager: 'Dov Amado', record: '4-1', potShare: '$41.25' },
  { manager: 'Marge Kowalski', record: '3-2', potShare: '$24.75' },
  { manager: 'Silas Brummell', record: '2-3', potShare: '$0.00' },
];

function GallerySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sh-gallery__section">
      <h2 className="sh-gallery__heading">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Renders every base component in isolation against the token system —
 * the design system's living reference. No backend, no data fetching.
 */
export function DesignSystemGallery() {
  return (
    <div className="sh-gallery">
      <GallerySection title="Colors">
        <div className="sh-gallery__grid">
          {Object.entries(cssCustomProperties).map(([name, value]) => (
            <div key={name} className="sh-gallery__swatch">
              <span className="sh-gallery__chip" style={{ background: `var(${name})` }} />
              <span className="sh-gallery__label">
                {name} · {value}
              </span>
            </div>
          ))}
        </div>
      </GallerySection>

      <GallerySection title="Typography">
        <div className="sh-gallery__type-sample" style={{ fontFamily: 'var(--sh-font-display)' }}>
          Fraunces — the house always shows the ledger
        </div>
        <div className="sh-gallery__type-sample" style={{ fontFamily: 'var(--sh-font-ui)' }}>
          Inter — interface text for rosters, waivers, and league chat
        </div>
        <div className="sh-gallery__type-sample" style={{ fontFamily: 'var(--sh-font-mono)' }}>
          IBM Plex Mono — 4,812 pts · 1,204 yds · $12,345.67
        </div>
      </GallerySection>

      <GallerySection title="Buttons">
        <div className="sh-gallery__row">
          <Button>Draft</Button>
          <Button variant="secondary">Propose trade</Button>
          <Button variant="danger">Drop player</Button>
        </div>
      </GallerySection>

      <GallerySection title="Panels, money, and clocks">
        <div className="sh-gallery__grid">
          <Panel title="Prize pool">
            <div className="sh-gallery__row">
              <Money cents={15000} />
              <Money cents={-2500} />
              <Badge tone="money">Buy-in paid</Badge>
            </div>
          </Panel>
          <Panel title="Pick clock" tone="raised">
            <div className="sh-gallery__row">
              <Clock secondsRemaining={47} />
              <Clock secondsRemaining={8} />
              <Badge tone="active">Pick live</Badge>
            </div>
          </Panel>
          <Panel title="Standings">
            <Table columns={standingColumns} rows={standings} />
          </Panel>
        </div>
      </GallerySection>

      <GallerySection title="Badges">
        <div className="sh-gallery__row">
          <Badge>Week 6</Badge>
          <Badge tone="active">On the clock</Badge>
          <Badge tone="danger">Vetoed</Badge>
        </div>
      </GallerySection>

      <GallerySection title="Icons — lucide, one set">
        <div className="sh-gallery__icon-row">
          <span className="sh-gallery__icon-item">
            <Coins size={20} aria-hidden />
            coins
          </span>
          <span className="sh-gallery__icon-item">
            <Timer size={20} aria-hidden />
            timer
          </span>
          <span className="sh-gallery__icon-item">
            <Gavel size={20} aria-hidden />
            gavel
          </span>
          <span className="sh-gallery__icon-item">
            <Users size={20} aria-hidden />
            managers
          </span>
        </div>
      </GallerySection>
    </div>
  );
}
