# Edge Template Pattern

## Overview

Since Edge directives (`@layout`, `@section`, `@end`, `@if`, `@each`, etc.) are not being processed correctly, we use a pattern that works with Edge expressions only.

## Pattern Rules

1. **No Edge Directives**: Remove all `@layout`, `@section`, `@end`, `@if`, `@each`, `@endeach`, `@endif`, `@csrf()` directives
2. **Full HTML Structure**: Each template includes the complete HTML structure (DOCTYPE, html, head, body)
3. **Edge Expressions Work**: Use `{{ route() }}` and `{{ variable }}` expressions - these work correctly
4. **CSRF Tokens**: Pass CSRF tokens from controllers and include as hidden inputs: `<input type="hidden" name="_csrf" value="{{ csrfToken }}" />`
5. **Loops & Conditionals**: Use JavaScript in `<script>` tags to handle loops and conditionals
6. **Data Formatting**: Format data in controllers before passing to templates (dates, URLs, etc.)

## Controller Pattern

```typescript
async methodName({ view, request, auth }: HttpContext) {
  // Get CSRF token
  const csrfToken = request.csrfToken

  // Format data for template (pre-process dates, generate URLs, etc.)
  const formattedData = data.map(item => ({
    ...item,
    createdAt: item.createdAt.toFormat('MMM dd, yyyy'),
    showUrl: router.makeUrl('route.name', { id: item.id }),
  }))

  return view.render('template/name', { data: formattedData, csrfToken })
}
```

## Template Structure

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page Title - Seeds Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-gray-50 min-h-screen">
    <!-- Navigation (same for all authenticated pages) -->
    <nav class="bg-white shadow-sm border-b">
      <!-- ... navigation HTML ... -->
    </nav>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <!-- Page content -->
      <div class="px-4 py-8 sm:px-0">
        <!-- Use Edge expressions: {{ route() }}, {{ variable }} -->
        <!-- Use JavaScript for loops/conditionals -->
        <div id="content"></div>
        <script>
          const data = {{ JSON.stringify(data) }};
          // Render content with JavaScript
        </script>
      </div>
    </main>
  </body>
</html>
```

## Navigation HTML (Reusable)

Include this navigation in all authenticated pages:

```html
<nav class="bg-white shadow-sm border-b">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex justify-between h-16">
      <div class="flex">
        <div class="flex-shrink-0 flex items-center">
          <a href="{{ route('home') }}" class="text-xl font-bold text-gray-900">Seeds Dashboard</a>
        </div>
        <div class="hidden sm:ml-6 sm:flex sm:space-x-8">
          <a
            href="{{ route('seeds.index') }}"
            class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
            >Seeds</a
          >
          <a
            href="{{ route('proofs.index') }}"
            class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
            >Proofs</a
          >
          <a
            href="{{ route('settings.edit') }}"
            class="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
            >Settings</a
          >
        </div>
      </div>
      <div class="flex items-center">
        <form method="POST" action="{{ route('auth.logout') }}">
          <input type="hidden" name="_csrf" value="{{ csrfToken }}" />
          <button
            type="submit"
            class="text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md text-sm font-medium"
          >
            Logout
          </button>
        </form>
      </div>
    </div>
  </div>
</nav>
```

## Examples

See:

- `resources/views/auth/login.edge` - Simple form
- `resources/views/auth/register.edge` - Simple form
- `resources/views/seeds/index.edge` - List with JavaScript loop
- `resources/views/seeds/create.edge` - Form with CSRF token
- `resources/views/seeds/show.edge` - Detail page with nested data
