# GitHub Copilot Instructions

This is an NX monorepo containing multiple applications and libraries. When providing suggestions or making changes, please follow these guidelines:

## Project Structure Awareness

1. Respect application boundaries:
   - Each application in `apps/` is independent
   - Changes should be confined to the specific application context being discussed
   - Follow the dependency graph when suggesting changes

2. Library Usage:
   - Use shared libraries from the `libs/` directory through their defined aliases
   - Follow the established pattern of library imports using `@onivoro/` prefixed paths
   - Respect the categorization of libraries:
     - `libs/axios/*` - API client libraries
     - `libs/browser/*` - Browser-specific shared components and utilities
     - `libs/isomorphic/*` - Code shared between client and server
     - `libs/server/*` - Server-side libraries

3. Import Resolution:
   - Always use the TypeScript path aliases defined in tsconfig.base.json
   - Never use relative paths to import from outside the current application boundary
   - Respect the module boundaries enforced by the NX project configuration
   - Analyze the existing code imported from `@onivoro/` prefixed paths to understand the full context of code referenced by a prompt

## Making Changes

1. When suggesting code changes:
   - Verify the context of the request relates to a specific application or library
   - Only modify files within the relevant application/library boundary including the files of dependent projects that have imports resolved in the tsconfig.base.json file
   - Follow the dependency chain defined in the project's NX configuration
   - Use appropriate imports from shared libraries instead of duplicating code

2. **Pattern Discovery and Consistency**:
   - **ALWAYS search for existing patterns first** before implementing new code
   - Look for similar implementations in the same application or related applications
   - Search for existing components, services, utilities, or configurations that solve similar problems
   - Copy and adapt existing patterns rather than creating new ones from scratch
   - Maintain consistency with established coding patterns, file structures, and naming conventions
   - If no existing pattern exists, create one that follows the established architectural principles

3. When adding new code:
   - Follow the dependency chain defined in the project's NX configuration
   - Use appropriate imports from shared libraries instead of duplicating code
   - Place new features in the appropriate application or library
   - Follow the existing pattern of module organization
   - Use the correct path aliases for imports
   - Consider whether the code should be shared via a library

## Application Types

- Browser applications (`apps/browser/*`): Web applications
- CLI applications (`apps/cli/*`): Command-line tools
- Lambda functions (`apps/lambda/*`): AWS Lambda functions
- Server applications (`apps/server/*`): Backend services
- Task applications (`apps/task/*`): Background processing tasks

Always consider the type of application when providing suggestions and ensure the code follows the patterns established for that application type.

## React Development Guidelines

When working with React code in browser applications:

1. **Material-UI Components**:
   - Always use `@mui/material` components instead of any alternatives (e.g., antd, chakra-ui, react-bootstrap)
   - Use `@mui/icons-material` for all icon requirements instead of other icon libraries
   - Follow Material-UI's theming and styling patterns
   - Leverage Material-UI's built-in TypeScript support

2. **Component Imports**:
   - **FORBIDDEN**: Importing from `@onivoro/browser/components` is strictly prohibited unless the prompt explicitly indicates otherwise
   - Prefer Material-UI components for all UI needs
   - Only use custom components from `@onivoro/browser/components` when specifically requested or when Material-UI doesn't provide the required functionality

3. **Styling**:
   - Use Material-UI's styling solutions (sx prop, theme-based styling, or Material-UI's styled API)
   - **FORBIDDEN**: Do not use styled-components library or Tailwind CSS or CSS rules in stylesheets
   - **FORBIDDEN**: Do not use any CSS-in-JS libraries other than Material-UI's built-in styling
   - **FORBIDDEN**: Never use `color` or `backgroundColor` properties in sx props, including pseudo states (`:hover`, `:focus`, etc.)
   - Maintain consistency with Material-UI's design system
   - Prefer the `sx` prop for component-level styling
   - Use Material-UI's theme palette and color variants instead of direct color values

4. **State Management**:
   - **PREFERRED**: Use Redux via Redux Toolkit (@reduxjs/toolkit) for all state management needs
   - **FORBIDDEN**: Do not use other state management solutions (Zustand, Jotai, Valtio, Context API for global state, etc.) unless explicitly requested
   - **FORBIDDEN**: Do not use RTK Query for data fetching
   - Follow Redux Toolkit patterns: createSlice, createAsyncThunk, configureStore
   - Prefer Redux Toolkit's built-in TypeScript support

5. **Context API Usage**:
   - When using `useContext`, follow the strict naming convention: `const [foo, fooAs] = useContext('whatever');`
   - The first variable should be the base name, the second should be the base name with "As" suffix
   - This convention ensures consistency and readability across all context usage in the codebase

## TypeScript Configuration

Respect the TypeScript configuration hierarchy:
- Base configuration: tsconfig.base.json
- Specialized configs:
  - tsconfig.isomorphic.json
  - tsconfig.server.json
  - tsconfig.web.json

Follow the strict type checking rules and maintain type safety across the codebase.

## Infrastructure as Code

1. Terraform Structure:
   - Infrastructure code is organized in the `terraform/` directory
   - Respect the separation between `environments/` and `modules/`:
     - `environments/` contains environment-specific configurations
     - `modules/` contains reusable infrastructure components
   - When suggesting changes:
     - Keep environment-specific changes in the appropriate environment directory
     - Place reusable components in modules
     - Follow existing module patterns and naming conventions

2. Infrastructure Changes:
   - When modifying infrastructure:
     - Consider the impact across all environments
     - Maintain consistency with existing resource naming patterns
     - Respect existing module interfaces and variable definitions
     - Follow AWS best practices for resource configurations

3. Module Usage:
   - Prefer using existing modules over creating new ones
   - When creating new modules:
     - Follow the established module structure
     - Include proper variable definitions and outputs
     - Document all module inputs, outputs, and dependencies
     - Provide examples in module documentation

4. Resource Organization:
   - Group related resources within logical module boundaries
   - Use consistent tagging strategies across all resources
   - Follow the principle of least privilege for IAM configurations
   - Consider resource dependencies and proper ordering