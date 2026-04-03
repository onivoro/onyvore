Onyvore, a VS Code extension for local-first personal knowledge management.

It's built with the @onivoro/server-vscode three-tier architecture
  (extension host + stdio server + React webview) in an Nx monorepo.                                                                                            
                                                                    
  Key docs to read first:                                                                                                                                       
  - readme/onyvore-prd.md — product requirements                                                                                                                
  - readme/onyvore-architecture.md — implementation details, project structure, all services and components
                                                                                                                                                                
  Project locations:                                                                                                                                            
  - Extension host: apps/vscode/onyvore/
  - Stdio server (NLP, search, link graph): apps/stdio/onyvore/                                                                                                 
  - React webview: apps/browser/onyvore/                       
  - Shared types/constants: libs/isomorphic/onyvore/                                                                                                            
                                                                                                                                                                
  Build commands:                                                                                                                                               
  - npx nx build app-stdio-onyvore                                                                                                                              
  - npx nx build app-browser-onyvore                                                                                                                            
  - npx nx build app-vscode-onyvore (chains all three)      
  - npm run onyvore:vsix (build + package VSIX)    