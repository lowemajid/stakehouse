import { DesignSystemGallery } from './gallery/DesignSystemGallery';

export default function App() {
  return (
    <main className="sh-home">
      <h1 className="sh-home__title">Stakehouse</h1>
      <hr className="sh-home__rule" />
      <p className="sh-home__lede">
        Demo-money fantasy leagues where the ledger is the product — transparent pots, live snake
        drafts, AI managers, and season-end payouts.
      </p>
      <p className="sh-home__note">
        Design-system slice — tokens, type, and base components below. The league engine, draft
        room, and payouts land in upcoming slices. Checkout is simulated; no real money moves here.
      </p>
      <DesignSystemGallery />
    </main>
  );
}
