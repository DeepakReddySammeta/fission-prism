/**
 * Renders one A2UI surface: the `@a2ui/react` engine (`<A2uiSurface>`) inside
 * the same Fission `<Card>` shell + coloured top border the hand-rolled
 * renderer used, so surfaces look identical to before. Actions are handled by
 * the runtime's global handler (wired in `planner/PlannerContext.tsx`), not a
 * per-surface prop.
 */
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { Card, CardContent } from '@/components/ui/card';
import { hasComponent } from './runtime';

export function Surface({ surface, className }: { surface: SurfaceModel<any> | undefined; className?: string }) {
  if (!surface || !hasComponent(surface, 'root')) return null;
  const primary =
    (surface.theme?.primaryColor === '#3b82f6' ? '#f25011' : surface.theme?.primaryColor) || '#888';
  return (
    <Card
      className={`section-card${className ? ` ${className}` : ''}`}
      style={{ borderTopWidth: 3, borderTopStyle: 'solid', borderTopColor: primary }}
    >
      <CardContent className="p-6">
        <A2uiSurface surface={surface as any} />
      </CardContent>
    </Card>
  );
}
