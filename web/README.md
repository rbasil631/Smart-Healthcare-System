# SmartHeart interface

The React single-page app served by `app/server.py`. Built with Vite, Tailwind CSS v4 and
[shadcn/ui](https://ui.shadcn.com) (Base UI primitives, `nova` style, `lucide` icons).

```powershell
npm install
npm run dev        # http://localhost:5173, proxies /api to a server on :8000
npm run build      # writes ../app/static -- commit the result with the source change
npm run lint
npm run typecheck
```

Run `python app/server.py` from the repository root in a second terminal while using `npm run dev`.

## Layout

| Path | What is in it |
|---|---|
| `src/App.tsx` | hash router and the role-to-view rules |
| `src/pages/` | one file per view: assess, patient history, patient list, doctors, admin, model |
| `src/components/` | risk strip, SHAP waterfall, trend chart, assessment table, dialogs, app shell |
| `src/components/ui/` | shadcn/ui components, added with `npx shadcn@latest add <component>` |
| `src/lib/` | typed API client, session context, formatting, model constants |
| `src/index.css` | the healthcare palette and every design token |
| `public/img/` | optional sign-in images, see the README there |

## Conventions

- Colours come from semantic tokens only: `bg-card`, `text-muted-foreground`, and the three
  verdict tokens `risk`, `refer` and `safe` (for example `bg-risk-tint`, `text-safe`). No raw
  Tailwind palette values, and no `dark:` overrides — the dark theme is a token swap in
  `src/index.css`.
- Forms use `Field` / `FieldGroup` / `FieldSet`; validation sets `data-invalid` on the `Field`
  and `aria-invalid` on the control.
- The app keeps the hash routes of the first version (`#history`, `#patient/7`,
  `#assessment/42`), so older links still work.
