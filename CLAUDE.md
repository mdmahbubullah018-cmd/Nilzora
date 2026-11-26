NILZORA — CLAUDE CODE PROJECT INSTRUCTIONS

Project: Nilzora
Product: Premium single-vendor e-commerce platform for Bangladesh
Environment: Windows + VS Code
Repository: "D:\Nilzora"
Development approach: Local-first, phased implementation
Deployment status: No production deployment is authorized.

This file is the canonical project instruction document for Claude Code. Read it before starting any task and follow it throughout the session.

The user may provide additional task-specific instructions through prompts. Those instructions supplement this file and define the current task's scope. Follow both this file and the latest task prompt. A task-specific instruction may authorize a normally restricted action only when the authorization is explicit and unambiguous.

Do not ask the user to repeat information already available in this file or the actual project.

---

1. PROJECT OVERVIEW

Nilzora is a premium single-vendor e-commerce platform designed primarily for customers in Bangladesh.

The platform consists of:

- Customer-facing Website.
- Android-first customer application, with future iOS compatibility.
- Admin dashboard.
- Permission-protected Moderator workspace.
- Staff management and operational tools.
- Backend API and business logic.
- PostgreSQL database and authentication.
- Product catalogue, variants, inventory and order management.
- Promotions, vouchers, campaigns and notifications.
- Customer support, returns and refunds.
- Analytics, reporting and operational monitoring.

The objective is to build a secure, maintainable, scalable, high-performance commerce platform with a consistent premium user experience.

Product principles

1. Correct business logic takes priority over superficial UI completion.
2. Security and data integrity must never be sacrificed for convenience.
3. Customer-facing functionality must work end-to-end.
4. Admin actions must correctly affect customer-facing data and workflows.
5. Website and Android should feel like parts of the same brand while respecting their platform-specific design patterns.
6. Do not mark a feature complete merely because its screen exists.
7. Preserve existing functionality and project decisions unless a genuine technical problem requires a change.

---

1. INSTRUCTION PRIORITY AND SAFETY RULES

These rules are mandatory.

1. Work only inside the existing Nilzora project directory unless explicitly authorized otherwise.
2. Read this "CLAUDE.md" before starting or resuming work.
3. Read relevant source files, configuration, tests and dependencies before modifying them.
4. Inspect the actual current workspace state instead of relying entirely on previous summaries.
5. Preserve existing work, user data, configuration and working functionality.
6. Never blindly overwrite files, mass-delete code or rewrite unrelated modules.
7. Everything remains local unless the user explicitly authorizes a particular external action.
8. Never create a GitHub repository, commit, push, deploy, publish packages or connect production services without explicit authorization.
9. Never reset a database, delete customer data, rewrite Git history, force-push or execute destructive commands without explicit approval.
10. Never expose secrets, passwords, tokens, private keys, service-role credentials or sensitive customer information.
11. Never put server-only secrets in browser or mobile bundles.
12. Never disable tests, weaken assertions, bypass authorization or suppress lint rules globally just to make checks pass.
13. Never fabricate test results, browser verification, device verification, migration results or build success.
14. Never claim a feature is complete unless its actual behavior has been verified to the level claimed.
15. Do not create unnecessary Markdown documents, reports, summaries or duplicate instructions. Report progress directly in chat unless a file is requested or genuinely required.
16. Ask before costly, irreversible, destructive, credential-sensitive or production-impacting operations.
17. Routine, reversible coding work within the authorized scope does not require repeated approval.
18. If an action is ambiguous and could affect external data, credentials, production infrastructure or business policy, stop and ask one focused question.
19. If context or tool limits interrupt work, leave the project in a coherent state and report exactly what remains.
20. Never continue into a different project or repository accidentally.

Project separation: Nilzora is a separate project. Do not mix its code, configuration, database, branding or architecture with Orvello or SportZoneBD.

---

1. TOKEN-EFFICIENT WORKING PROTOCOL

Efficiency is important. Use tokens for implementation and meaningful verification, not repeated explanations.

- Read this file once at the beginning of a task and follow it throughout.
- Inspect the actual project state before asking the user for information.
- Reuse existing architecture, components, design tokens, API clients, schemas and utilities.
- Search for existing implementations before creating new ones.
- Avoid repeatedly printing large file contents, full directory listings or unchanged code.
- Do not generate a long plan for every small task.
- Plan only the requested task and its necessary dependencies.
- Use concise progress updates with meaningful findings, changed areas, verification and blockers.
- Avoid repeated explanations of known architecture.
- Do not rerun expensive full test suites after every minor styling change.
- Run focused tests during implementation and appropriate regression checks at the end.
- Do not create unnecessary abstractions or documentation merely to make the implementation appear more comprehensive.
- Do not independently start the next phase after completing the requested task.
- If an essential decision is missing, ask one focused question. Otherwise, make a reasonable, reversible decision consistent with this file.
- Never claim to remember project information that is not available in the current context or workspace.

Task prompt instructions

Every new task prompt from the user must be treated as an additional requirement.

For each new task:

1. Read this file.
2. Read the latest task prompt carefully.
3. Identify the exact requested scope.
4. Check which requested items are already complete.
5. Implement only what remains necessary.
6. Preserve previously completed work.
7. Add newly requested requirements to the current task's scope.
8. Do not silently ignore a requirement because it was not previously documented in this file.

If the task prompt contains a requirement that is not part of the permanent project rules, follow it for that task without unnecessarily expanding the permanent project scope.

---

1. TECHNOLOGY STACK

Use this stack unless inspection reveals a concrete compatibility problem or the user explicitly approves a change.

Area| Technology
Monorepo| pnpm workspaces
Storefront| Next.js, React, TypeScript
Admin / Moderator| Next.js, TypeScript
Mobile| React Native, Expo, Expo Router
Backend| Node.js, Express, TypeScript
Database| Supabase PostgreSQL
Authentication| Supabase Auth
Web styling| Tailwind CSS v4
UI components| shadcn/ui where appropriate
Data fetching| TanStack Query
Client state| Component/local state first
Global state| Redux Toolkit only when justified
Validation| Zod
Web icons| lucide-react
Native icons| lucide-react-native
Web animation| Motion, used selectively
Native animation| React Native Reanimated
Media storage| Cloudflare R2
Push notifications| Firebase Cloud Messaging, with future APNs support
Cache / queues| Redis only when justified
Testing| Vitest, integration tests, Playwright and appropriate mobile testing

Dependency discipline

- Inspect package manifests, workspace configuration and lockfiles before changing dependencies.
- Prefer existing packages and utilities.
- Do not install redundant libraries.
- Avoid major version upgrades unless required and compatible.
- Do not change architecture for convenience.
- Justify any new dependency based on a concrete requirement.
- Keep the API as a modular monolith. Do not introduce microservices without explicit approval and a compelling technical reason.

---

1. PROJECT ARCHITECTURE

Expected workspace structure, subject to the actual repository:

- "apps/storefront" — customer Website.
- "apps/admin" — Admin dashboard and protected Moderator workspace.
- "apps/mobile" — Android-first customer application.
- "apps/api" — Express business API.
- "packages/contracts" — shared API contracts and types.
- "packages/api-client" — reusable typed API client.
- "packages/validation" — shared validation schemas.
- "packages/design-tokens" — brand design tokens.
- "packages/typescript-config" — shared TypeScript configuration.
- "packages/eslint-config" — shared lint configuration.
- "supabase/migrations" — database migrations.
- "supabase/tests" — database and RLS tests.
- "assets/brand" — supplied brand assets.

Maintain clear boundaries between:

- Presentation and UI.
- Business logic.
- Database access.
- Authentication.
- Authorization.
- Validation.
- External integrations.
- Shared contracts.

Do not create empty scaffolding and describe it as a completed feature.

Do not move or rename existing modules merely to match this illustrative structure.

---

1. BRAND IDENTITY AND DESIGN SYSTEM

Nilzora already has an established visual direction. Do not invent a new identity or change brand colors without authorization.

Official color palette

Token| Value
Navy| "#0F172A"
Slate| "#334155"
Muted Slate| "#CBD5E1"
Soft Background| "#F1F5F9"
Sky Accent| "#38BDF8"
Primary| "#0284C7"
Primary Hover / Pressed| "#0369A1"
Violet| "#8B5CF6"
Success| "#22C55E"
Warning| "#F59E0B"
Error| "#EF4444"
Offer Badge| "#F43F5E"
Moderator Accent| "#14B8A6"

Use the existing design tokens and source CSS variables. Map them correctly into Tailwind CSS v4 theme variables.

Avoid duplicate, circular or conflicting token definitions.

Use accessible contrast. Important action buttons and offer-badge text must meet WCAG AA contrast requirements where applicable.

Logo and official assets

Inspect the actual supplied SVG and image files in "assets/brand" or the existing brand asset directory.

- Preserve original artwork, colors, proportions and transparency.
- Use the official supplied assets.
- Never redraw, recreate, invent, recolor or distort the official Nilzora logo.
- Never create a fake official logo variant.
- If an official asset is missing, use a temporary placeholder and report the missing asset.
- Use the correct logo variant for Website, Admin, Moderator and Android.
- Ensure logo rendering is responsive and accessible.

Design direction

Customer Website and Android:

- Premium, clean, modern commerce experience.
- Bright, spacious and easy to navigate.
- Strong product imagery and clear visual hierarchy.
- Consistent typography, spacing and component dimensions.
- Polished loading, empty, error and success states.
- Native-feeling mobile interactions.

Admin:

- Navy navigation.
- Light page background.
- White or neutral cards.
- Clear tables, analytics and operational workflows.
- Efficient information density.

Moderator:

- Distinct but consistent styling.
- Restrained teal/indigo accents.
- Permission-controlled moderation queue.

Dark mode:

- Keep design tokens dark-mode-ready.
- Do not independently redesign the entire product for dark mode unless requested.

Avoid excessive gradients, animation, shadows, oversized controls and decorative clutter.

Use leading commerce products only as usability inspiration. Do not copy proprietary assets or branding.

---

1. UI/UX OWNERSHIP AND QUALITY CONTROL

Claude is responsible for identifying relevant visual and interaction problems within the requested scope.

Do not wait for the user to identify every obvious UI defect.

Before changing a screen:

1. Inspect its current implementation.
2. Inspect related shared components.
3. View the actual rendered screen when possible.
4. Understand the page's intended customer or staff workflow.
5. Identify missing, unfinished, inconsistent or broken elements.

Build complete page experiences appropriate to their purpose. Relevant sections may include:

- Hero banners.
- Promotional campaigns.
- Category showcases.
- Brand showcases.
- Product collections.
- Product recommendations.
- Editorial content.
- Trust indicators.
- Useful supporting information.

Do not add sections indiscriminately. Use real data and existing business requirements.

UI verification rules

- A route loading successfully does not prove that its page is complete.
- A passing unit test does not prove that the screen looks correct.
- A screenshot does not prove that interactive functionality works.
- A build does not prove that the actual device is using the latest code.
- Inspect desktop and mobile layouts where relevant.
- Verify real navigation, buttons, forms, filters and interactions.
- Check loading, empty, error and disabled states.
- Fix relevant visual and functional defects discovered within the current task.
- Keep unrelated redesigns outside the requested scope.

Platform-specific UI

Website and Android should share design principles and business logic, but they do not need identical visual components.

Use platform-specific UI when it improves:

- Navigation.
- Touch interaction.
- Scrolling.
- Bottom sheets.
- Safe-area handling.
- Responsive layout.
- Performance.
- Accessibility.

Do not force a shared component when it creates platform-specific UI problems.

---

1. LANGUAGE POLICY

Customer-facing Website and Android application:

- English only.
- Do not introduce Bangla translations or language switching.
- Customer-facing notifications, emails and messages should remain English unless the user explicitly changes this policy.

Admin, Moderator and Staff interfaces:

- Bangla and English support may be provided.
- Use the established language preference and translation architecture.
- Do not mix untranslated labels unnecessarily.

API, database and internal code:

- Use clear, consistent English naming.
- Keep user-facing translations separate from internal identifiers.

---

1. USER ROLES, RBAC AND AUTHORIZATION

Required roles:

- Super Admin / Owner.
- Admin.
- Staff.
- Moderator.
- Customer.

Support multiple staff and moderator accounts with customizable permissions.

Use a maintainable permission system based on concepts such as:

- "roles"
- "permissions"
- "user_roles"
- "role_permissions"
- "user_permissions"

Permission groups may include:

- Products.
- Product variants.
- Categories and brands.
- Inventory.
- Orders.
- Customers.
- Promotions and vouchers.
- Returns and refunds.
- Moderation.
- Finance.
- Staff management.
- Settings.
- Analytics.
- Audit logs.

Security requirements

1. Public registration must never grant privileged roles.
2. The server is the authority for protected operations.
3. Hiding UI controls is not a security boundary.
4. Authenticate and authorize every protected endpoint.
5. An admin cannot grant privileges beyond their own permitted scope.
6. Super-admin-only operations require explicit server-side authorization.
7. Use deny-by-default authorization.
8. Explicit permission denial must take precedence over a granted role permission where overrides exist.
9. Never trust client-supplied roles, permissions, prices, discounts, totals or inventory values.
10. Protect staff management, financial operations, audit logs and sensitive settings separately.
11. Record important privileged actions in audit logs.
12. Do not log secrets or unnecessary personal information.

Test both authorized and unauthorized paths.

---

 1. AUTHENTICATION, DATABASE AND RLS

Supabase Auth manages identity. Application profiles and permissions belong to the application database.

- Link "profiles.id" to "auth.users.id".
- Do not use an ordinary editable profile role as the authorization source.
- Apply Row Level Security to relevant tables.
- Test policies using different users and roles.
- Customers can access only their permitted personal information and orders.
- Public users can see only active, publicly visible products.
- Sensitive writes must go through authorized server workflows.
- Keep the Supabase service-role key server-side.
- Validate required environment variables.
- Fail safely when required configuration is missing.
- Never reset or delete a database without explicit approval.

Use versioned SQL migrations with:

- Appropriate foreign keys.
- Constraints.
- Indexes.
- Safe defaults.
- Clear ownership rules.
- Appropriate RLS policies.
- Reproducible schema setup.

Use safe Development seed data. Never use real customer or production data as disposable test data.

---

 1. DATABASE MIGRATION AND HOSTED DEVELOPMENT POLICY

Database changes must be handled carefully.

Before creating a migration

1. Inspect the current schema.
2. Inspect existing migration history.
3. Check whether the required column, table, index, function or policy already exists.
4. Search for dependencies on functions or schema objects being modified.
5. Determine whether the feature can be implemented using the existing schema.
6. Create a migration only when a genuine schema change is necessary.

Never create duplicate or meaningless migrations.

Migration quality

- Use descriptive, timestamped migration filenames.
- Make changes safe for existing data.
- Avoid destructive changes.
- Preserve existing records.
- Add constraints and indexes where justified.
- Check function signatures and dependent SQL objects.
- Verify RLS and grants.
- Avoid accidental privilege escalation.
- Ensure fresh local database setup remains reproducible.

Applying migrations

Default policy: local development first.

Applying a migration to a hosted Development database requires explicit authorization in the current task or an existing unambiguous authorization covering that exact operation.

If authorized:

1. Confirm the exact project reference.
2. Confirm that it is the intended Development project.
3. Review the migration SQL.
4. Apply only the intended migration.
5. Verify migration history.
6. Verify the resulting schema and database behavior.
7. Run relevant database and API tests.
8. Report the exact project and migration result.

Never assume that authorization for one migration authorizes unrelated database changes.

Never touch production or another Supabase project without explicit approval.

---

 1. COD ORDERS AND INVENTORY

The initial release uses Cash on Delivery.

Keep order status separate from payment status.

A COD order may be confirmed while payment remains pending. Only an authorized workflow can mark cash as collected.

For every order:

- The server loads current product data.
- The server calculates prices and totals.
- The server validates product status, quantities, addresses, discounts and stock.
- Order creation, item snapshots and inventory changes use a reliable atomic database workflow.
- Prevent overselling under concurrent requests.
- Use idempotency for duplicate order submissions.
- Maintain order status history.
- Maintain inventory movement history.
- Validate every status transition and cancellation.
- Do not trigger external side effects before the database transaction commits.

Use PostgreSQL transactions or appropriate database functions/RPCs when needed.

Do not simulate atomic transactions with unrelated independent writes.

Do not implement online payment processing unless explicitly requested.

---

 1. PRODUCT CATALOGUE AND VARIANT RULES

Products may contain:

- Multiple sizes.
- Multiple colours.
- Product images.
- Variant-specific images.
- Variant-specific stock.
- Product attributes and specifications.
- Category and brand relationships.

The catalogue must use actual product and variant data.

Filtering requirements:

- Size and Colour options must come from valid variant data.
- Do not show unavailable options as selectable choices.
- Combine filters correctly with category, brand, price, availability, search and sorting.
- Avoid duplicate products.
- Keep facet results and counts consistent.
- Preserve selected filters and query parameters.
- Pagination must respect the current filter state.
- Clearing one filter must not unintentionally clear unrelated filters.

Do not implement fake frontend-only filtering when the business logic requires server-side filtering.

When modifying catalogue SQL functions, inspect existing overloads, dependencies and API contracts before changing signatures.

---

 1. RETURNS, REFUNDS AND ORDER CANCELLATION

Return and refund functionality is a business-critical workflow.

Do not assume that a screen or button proves the workflow is functional.

Verify the entire customer-to-admin process.

Customer workflow

- Display relevant customer orders.
- Enforce return eligibility according to the existing policy.
- Validate product, quantity, reason and required information.
- Persist actual return requests.
- Prevent duplicate or invalid submissions.
- Show accurate request status.
- Display refund progress when applicable.
- Reflect real Admin decisions.
- Provide clear error, success and pending states.

Admin workflow

- Display incoming requests.
- Show correct customer, order, product, quantity and reason details.
- Enforce role and permission requirements.
- Support valid review, approval and rejection workflows.
- Preserve request history and audit information.
- Update customer-facing status correctly.
- Prevent invalid or duplicate state transitions.

Refund integrity

- Do not mark a refund as completed merely because an approval button was clicked.
- Verify the actual payment/refund state.
- Prevent duplicate refunds.
- Keep order, payment, return and refund states consistent.
- Respect the existing COD refund policy.
- If external refund processing is unavailable, show an accurate pending/manual state.
- Never pretend that money has been refunded when no verified refund has occurred.

---

 1. API AND BUSINESS LOGIC

Use versioned REST routes under "/api/v1".

Implement appropriate:

- Authentication middleware.
- Authorization middleware.
- Zod validation.
- Consistent error handling.
- Request IDs.
- Pagination and filtering.
- Rate limiting.
- Safe logging.
- Health checks.
- Integration tests.
- API contracts.
- OpenAPI documentation where useful.

Business rules must remain on the server.

Do not independently duplicate critical pricing, permissions, inventory or order logic across Website, Android and Admin.

Never expose internal stack traces or secrets in API responses.

---

 1. MEDIA, CLOUDFLARE R2 AND BRAND ASSETS

Use Cloudflare R2 for application media where configured.

Uploads must validate:

- Content type.
- File size.
- Image dimensions.
- Ownership.
- Permitted destination.
- Safe object keys.

Use appropriate image optimization, metadata stripping, resizing, WebP/AVIF conversion and CDN caching where supported.

Keep R2 credentials server-side.

For brand and collection images:

- Preserve image aspect ratios.
- Avoid stretching.
- Use "contain" for logos.
- Use appropriate cover behavior for banners.
- Keep logo and banner assets separate.
- Do not replace an existing logo with a banner.
- Do not invent brand artwork.

Do not claim an external upload integration is operational without an actual end-to-end test.

---

 1. NOTIFICATIONS AND EXTERNAL INTEGRATIONS

For push notifications:

- Associate device tokens with the correct authenticated user.
- Use server-controlled delivery workflows.
- Handle retries and invalid tokens.
- Avoid unnecessary sensitive information in payloads.
- Do not make notification delivery a prerequisite for successful order processing.

For external integrations:

- Inspect existing configuration before modifying it.
- Keep credentials server-side.
- Do not print secrets.
- Do not claim an integration works until its actual end-to-end behavior is verified.
- Ask before enabling, changing or connecting production services.

---

 1. WEBSITE AND ANDROID PERFORMANCE

Performance improvements must be based on actual problems.

Website

Inspect:

- Server and client component boundaries.
- Next.js navigation.
- TanStack Query configuration.
- Query keys.
- "staleTime" and "gcTime".
- Cache invalidation.
- Duplicate requests.
- Image optimization.
- Bundle size.
- Unnecessary component remounting.

Preserve customer-specific cache isolation. Never allow one customer's private data to appear for another customer.

Android

Inspect:

- Unnecessary re-renders.
- List and carousel performance.
- Image loading.
- Navigation behavior.
- Query caching.
- Memory usage.
- Scroll performance.
- Safe-area handling.
- Animation overhead.

Do not reduce data correctness or security to make a screen appear faster.

Measure relevant behavior before claiming an improvement.

---

 1. ANDROID BUILD AND DEVICE VERIFICATION

Android development must account for the possibility of a stale embedded JavaScript bundle.

For UI or JavaScript changes, do not assume that a successful Gradle build automatically includes the latest code.

Use the established build command:

"pnpm android:apk"

This command must generate/embed the current Expo JavaScript bundle before building the debug APK.

Then install the APK using:

"adb install -r"

Preserve the existing package identity, signing identity and application data.

Required verification

When actual device verification is requested or required by the task:

1. Check the connected device.
2. Generate the latest embedded bundle.
3. Build using "pnpm android:apk".
4. Install using "adb install -r".
5. Stop Metro.
6. Launch the installed application.
7. Verify the latest changes with Metro stopped.
8. Check real navigation, interactions, layout and data behavior.

The known test device is:

- Honor 200.
- Device model: "ELI-NX9".

Do not claim Honor 200 verification if the device was unavailable or the test was not performed.

Do not use an old APK as evidence of current functionality.

Do not uninstall the application or clear its data unless explicitly necessary and authorized.

---

 1. TESTING AND QUALITY GATES

Testing should be meaningful, focused and evidence-based.

During implementation

Run targeted checks for the changed areas.

Examples:

- Unit tests for modified business logic.
- API integration tests for changed endpoints.
- Database tests for modified migrations or RLS.
- Component tests for relevant UI behavior.
- Typecheck and lint for affected packages.

Final verification

Run the necessary regression checks once the requested implementation is complete.

Use available project scripts rather than inventing commands.

Relevant checks may include:

- Lint.
- Typecheck.
- Unit tests.
- API integration tests.
- Database/RLS tests.
- Production builds.
- Playwright browser tests.
- Mobile export/build.
- Real Android device tests.

Mandatory security and business checks

Where relevant, verify:

- Registration cannot escalate privileges.
- Customers cannot access another customer's private data.
- Unauthorized users cannot access protected Admin/Moderator operations.
- Admins cannot grant forbidden permissions.
- Invalid inputs are rejected.
- Client-supplied prices and totals are not trusted.
- Concurrent orders cannot oversell inventory.
- Duplicate submissions are handled safely.
- COD status transitions remain consistent.
- RLS denies unauthorized access.
- Upload permissions prevent cross-user access.
- Client bundles contain no server secrets.
- Return/refund transitions are valid and idempotent.

Avoid meaningless testing

- Do not repeatedly run every test suite after small CSS changes.
- Do not add superficial tests that only assert that a component renders.
- Do not use fake data to claim real integration success.
- Do not remove assertions to make tests pass.
- Do not suppress failures.
- Do not report a test as passing unless the command actually completed successfully.

If a check cannot run because Docker, credentials, an emulator, a browser or another dependency is unavailable, state the exact limitation and run feasible alternatives.

---

 1. REAL BROWSER AND VISUAL VERIFICATION

When a task changes customer-facing Website UI or behavior, use a real browser where feasible.

Relevant viewport sizes:

- Mobile: 360px.
- Mobile: 390px.
- Tablet.
- Desktop: 1440px.

Verify relevant screens and workflows, including:

- Homepage.
- Brand and category pages.
- Product listing.
- Product Details.
- Search and filtering.
- Sort and Price controls.
- Cart and checkout where affected.
- Customer account and orders.
- Return/refund workflow.
- Promotions and popup display.
- Website navigation.
- Admin workflows where affected.

Inspect:

- Actual rendering.
- Horizontal overflow.
- Clipping and overlap.
- Console errors.
- Network failures.
- API responses.
- Loading and empty states.
- Real button and form interactions.
- Responsive behavior.

Do not claim browser verification merely because a route returned HTTP 200.

---

 1. LOCAL DEVELOPMENT AND SERVICE CONFIGURATION

Known local URLs:

Service| URL
Storefront| "<http://localhost:3000>"
Admin| "<http://localhost:3001>"
API| "<http://localhost:4000>"

Keep these ports and application boundaries distinct.

Before starting a service:

- Check whether it is already running.
- Avoid duplicate processes.
- Confirm the correct environment.
- Avoid connecting a local test session to an unintended remote database.
- Check API CORS configuration where relevant.
- Do not leave unnecessary background processes running without informing the user.

The local project remains the default working environment.

---

 1. ENVIRONMENT VARIABLES AND SECRETS

Whenever a new environment variable is required:

1. Verify its exact name from the actual code or configuration.
2. Determine its purpose and correct application scope.
3. Identify whether it is required or optional.
4. Add it to the appropriate ".env.example" when necessary.
5. Follow the user's current local environment-file policy before modifying ".env", ".env.local" or other local files.
6. Preserve existing real values.
7. Never replace existing secrets with blank values.
8. Never invent a variable or secret value.
9. Never copy a real secret into documentation, source code or client bundles.
10. Never expose server-only credentials through "NEXT_PUBLIC_*" or "EXPO_PUBLIC_*".

Use blank placeholders in ".env.example".

Tell the user which new variables they must fill in manually.

If a local environment file must be created or changed, first ensure the action is permitted by the current project instructions and task authorization.

---

 1. GIT, DEPLOYMENT AND EXTERNAL SERVICES

Default state: local-only development.

Do not:

- Initialize a new Git repository.
- Create a GitHub repository.
- Commit changes.
- Push code.
- Force-push.
- Rewrite Git history.
- Deploy to Vercel or another hosting service.
- Publish packages.
- Change production configuration.
- Connect or modify production services.

The user controls GitHub creation and code publishing.

If the user explicitly authorizes one of these actions, perform only the authorized operation and report its result.

Never interpret authorization for a local implementation task as permission to deploy.

---

 1. PHASE-BASED EXECUTION

Work only on the task or phase the user explicitly requests.

Suggested overall development sequence:

1. Workspace and environment foundation.
2. Monorepo and development tooling.
3. Brand tokens and shared UI foundations.
4. Backend foundation.
5. Database, migrations, authentication, authorization and RLS.
6. Customer Website.
7. Admin and Moderator workflows.
8. Android-first mobile application.
9. Media storage and push notifications.
10. Integration, browser, device and end-to-end verification.
11. Final local handoff.

This sequence is guidance, not permission to start every phase.

Phase state verification

Before starting or resuming a phase:

- Inspect the current workspace.
- Inspect relevant source files.
- Inspect existing tests.
- Check the current migration state when relevant.
- Check whether an agent or process is already working on the same task.
- Identify completed, incomplete and unverified items.

Treat previous reports as evidence to verify, not unquestionable truth.

Distinguish clearly between:

- Implemented.
- Automated-tested.
- API/database-integrated.
- Browser-verified.
- Physical-device-verified.
- Production-deployed.

Do not restart completed work unnecessarily.

Do not begin the next phase without authorization.

---

 1. COMPLETION AND REPORTING

A task is complete only when its requested implementation and relevant verification are finished.

At the end, report directly in chat.

Include:

1. What was already complete and left unchanged.
2. What was newly implemented.
3. Important bugs found and their root causes.
4. Important files, components, API endpoints or database areas changed.
5. Migrations created and their application status, if any.
6. Exact test commands actually executed and their results.
7. Browser verification results, where applicable.
8. Android APK build/install/device verification results, where applicable.
9. Remaining issues and exact blockers.
10. Any environment variables or manual configuration the user must provide.

Use accurate completion labels:

- Implemented and verified
- Implemented but not fully verified
- Partially implemented
- Not implemented
- Blocked

Do not use vague claims such as "everything works perfectly" or "100% complete" without evidence.

Do not create a separate report file unless requested.

Keep the final report concise but sufficiently detailed for the user to understand exactly what changed and what remains.

---

 1. FINAL OPERATING DIRECTIVE

At the beginning of every task:

1. Read this "CLAUDE.md".
2. Read the latest task-specific prompt.
3. Inspect the actual current workspace and project state.
4. Identify completed work and genuine remaining work.
5. Implement the requested scope without unnecessary rewrites.
6. Preserve security, data integrity and existing functionality.
7. Run meaningful focused tests.
8. Perform real browser or device verification when required.
9. Fix defects discovered during verification.
10. Report actual results and stop.

The latest task-specific prompt and this "CLAUDE.md" must both be followed.

Prioritize correct implementation, reliable business behavior, security, premium design quality and real verification. Avoid unnecessary token consumption, meaningless testing, repeated work and unsupported completion claims.

Do not proceed to unrelated tasks or the next development phase without the user's authorization.
