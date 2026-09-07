Here are the exact steps to publish to the VS Code Marketplace:                                                            
                                                                                                                                                                
  1. Create a publisher account
                                                                                                                                                                
  1. Go to https://marketplace.visualstudio.com/manage      
  2. Sign in with a Microsoft account (or create one)                                                                                                           
  3. Create a publisher — pick an ID (e.g., onivoro). This must match the "publisher" field in your package.json.
                                                                                                                                                                
  2. Create a Personal Access Token (PAT)

  1. Go to https://dev.azure.com and sign in with the same Microsoft account.
     You need an Azure DevOps organization; if you have none, create one when prompted.
  2. Open the User settings dropdown next to your profile image, and choose
     "Personal access tokens". (This is the settings control beside the avatar,
     not the avatar itself.)
  3. Select "New Token".
  4. Set Organization to "All accessible organizations". A token scoped to a
     single organization will fail with a confusing access error at publish time.
  5. Set Scopes to "Custom defined", then click "Show all scopes" — Marketplace
     is hidden until you do. Scroll to Marketplace and check "Manage".
  6. Set an expiration. Azure enforces its own maximum, and an expired token is
     the most common publish failure: the secret still exists, so nothing looks
     wrong until the publish step returns "The Personal Access Token used has
     expired."
  7. Copy the token immediately — you will not see it again.

  Current official steps: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

  3. Log in with vsce                                                                                                                                           
                                                                                                                                                                
  npx @vscode/vsce login onivoro                                                                                                                                        
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