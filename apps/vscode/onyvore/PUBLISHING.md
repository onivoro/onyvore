Here are the exact steps to publish to the VS Code Marketplace:                                                            
                                                                                                                                                                
  1. Create a publisher account
                                                                                                                                                                
  1. Go to https://marketplace.visualstudio.com/manage      
  2. Sign in with a Microsoft account (or create one)                                                                                                           
  3. Create a publisher — pick an ID (e.g., onivoro). This must match the "publisher" field in your package.json.
                                                                                                                                                                
  2. Create a Personal Access Token (PAT)
                                                                                                                                                                
  1. Go to https://dev.azure.com                                                                                                                                
  2. Sign in with the same Microsoft account
  3. Click your profile icon → Personal access tokens                                                                                                           
  4. Click + New Token                                                                                                                                          
  5. Set Organization to All accessible organizations
  6. Set Scopes → Custom defined → check Marketplace > Manage                                                                                                   
  7. Set an expiration (max 1 year)                                                                                                                             
  8. Copy the token immediately — you won't see it again                                                                                                        
                                                                                                                                                                
  3. Log in with vsce                                                                                                                                           
                                                                                                                                                                
  npx vsce login onivoro                                                                                                                                        
  # Paste the PAT when prompted                             

  4. Verify your package.json                                                                                                                                   
  
  Ensure these fields are set in apps/vscode/onyvore/package.json:                                                                                              
  - "publisher": "onivoro" — must match your publisher ID   
  - "repository" — required                                                                                                                                     
  - "version" — semver                                      
  - "icon" — marketplace listing icon (currently resources/icon.svg; marketplace prefers a 128x128 PNG, not SVG)                                                
  - "license" — e.g., "MIT" or a LICENSE file                                                                                                                   
  - "description" — shows on the listing                                                                                                                        
                                                                                                                                                                
  5. Build and publish                                                                                                                                          
                                                                                                                                                                
  npm run onyvore:vsix                    # build the VSIX  
  npx vsce publish --packagePath apps/vscode/onyvore/onyvore.vsix                                                                                               
                                                                                                                                                                
  Or skip the VSIX step and publish directly:                                                                                                                   
  cd apps/vscode/onyvore/dist && npx vsce publish --no-dependencies                                                                                             
                                                                                                                                                                
  6. Verify                                                                                                                                                     
  
  Your extension will appear at https://marketplace.visualstudio.com/items?itemName=onivoro.onyvore within a few minutes.                                       
                                                            
  Watch out for:                                                                                                                                                
  - The marketplace icon must be PNG (128x128 or 256x256), not SVG — add a separate "icon" field pointing to a PNG
  - Add a LICENSE file or "license" field                                                                                                                       
  - The "engines.vscode" version constraint must be valid