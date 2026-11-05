import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '../../components/ui.jsx';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      body="That route does not exist in this console."
      action={<Link to="/"><Button kind="primary">Back to overview</Button></Link>}
    />
  );
}
