#!/usr/bin/env node
import path from 'path'
import fs from 'fs'
import os from 'os'
import simpleGit from 'simple-git'

// Try to load environment variables from multiple locations
const envFiles = [
  path.join(process.cwd(), '.ayay'),
  path.join(os.homedir(), '.ayay')
];

for (const envFile of envFiles) {
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile })
    break
  }
}

async function generateCommitMessage(diff) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Generate a concise, descriptive git commit message for the following changes. Use conventional commits format. Only return the commit message, nothing else.\n\n${diff}`
          }]
      })
    })

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json()
    return data.content[0].text.trim()
  } catch (error) {
      console.error('Error generating commit message:', error);
      return 'chore: update submodule changes'
  }
}

async function processRepository(repoPath, isSubmodule = false) {
  try {
      const repoType = isSubmodule ? 'submodule' : 'repository'
      console.log(`\nProcessing ${repoType}: ${repoPath}`)

      // Change to repository directory
      process.chdir(repoPath)
      const git = simpleGit()

      // For main repository, update submodule references
      if (!isSubmodule) {
          console.log('Updating submodule references...')

          // Get list of submodules
          const submoduleStatusResult = await git.submoduleStatus()
          const submoduleList = Object.keys(submoduleStatusResult)

          // Process each submodule individually
          if (submoduleList.length > 0) {
            console.log(`Found ${submoduleList.length} submodules to update`)

            for (const submodulePath of submoduleList) {
              try {
                console.log(`Updating submodule: ${submodulePath}`)

                // Move into the submodule directory
                const originalDir = process.cwd()
                process.chdir(path.join(repoPath, submodulePath))
                const submoduleGit = simpleGit()

                // Checkout main and pull changes
                await submoduleGit.checkout('main')
                await submoduleGit.pull('origin', 'main')

                // Return to the original directory
                process.chdir(originalDir)
                console.log(`Successfully updated submodule: ${submodulePath}`)
              } catch (submoduleError) {
                console.error(`Error updating submodule ${submodulePath}:`, submoduleError)
              }
            }
          } else {
            console.log('No submodules found to update')
          }
      }

      // Check if there are any changes
      const status = await git.status()
      if (status.isClean()) {
          console.log(`No changes in this ${repoType}`);
          return
      }

      // Get the diff for commit message generation
      const diff = await git.diff()
      // Stage all changes
      await git.add('.')
      // Generate commit message using Anthropic
      const commitMessage = await generateCommitMessage(diff)

      // Create commit with better error handling
      try {
        console.log(`Attempting to commit with message: "${commitMessage}"`)

        // Check git configuration
        try {
          const config = await git.listConfig()
          const userName = config.values['.git/config']['user.name']
          const userEmail = config.values['.git/config']['user.email']
          console.log(`Git user configured as: ${userName} <${userEmail}>`)
        } catch (configError) {
          console.error('Git user not configured properly:', configError.message)
        }

        await git.commit(commitMessage)
      } catch (commitError) {
        console.error('Git commit failed with error:')
        console.error(commitError.message)
        throw commitError
      }

      // Push changes to remote
      await git.push('origin', 'main')
      console.log(`Successfully committed and pushed changes in ${repoType}`)
  } catch (error) {
      console.error(`Error processing ${isSubmodule ? 'submodule' : 'repository'} ${repoPath}:`, error)
  }
}

async function processSubmodule(submodulePath) {
  try {
    console.log(`\nProcessing submodule: ${submodulePath}`)
    const originalDir = process.cwd()

    try {
      // Change to submodule directory
      process.chdir(submodulePath)
      const git = simpleGit()

      // Check if there are any changes
      const status = await git.status()
      if (status.isClean()) {
          console.log('No changes in this submodule');
          return
      }

      // Get the diff for commit message generation
      const diff = await git.diff()
      // Stage all changes
      await git.add('.')
      // Generate commit message using Anthropic
      const commitMessage = await generateCommitMessage(diff)

      // Create commit with better error handling
      try {
        console.log(`Attempting to commit with message: "${commitMessage}"`)

        // Check git configuration
        try {
          const config = await git.listConfig()
          const userName = config.values['.git/config']['user.name']
          const userEmail = config.values['.git/config']['user.email']
          console.log(`Git user configured as: ${userName} <${userEmail}>`)
        } catch (configError) {
          console.error('Git user not configured properly:', configError.message)
        }

        await git.commit(commitMessage)
      } catch (commitError) {
        console.error('Git commit failed with error:')
        console.error(commitError.message)
        throw commitError
      }

      // Push changes to remote
      await git.push('origin', 'main')
      console.log('Successfully committed and pushed changes')
    } finally {
      // Always return to original directory
      process.chdir(originalDir)
    }

  } catch (error) {
    console.error(`Error processing submodule ${submodulePath}:`, error)
  }
}

async function main() {
  try {
    // Get the root directory
    const rootDir = process.cwd()
    const packagesDir = path.join(rootDir, 'packages')

    // Check if packages directory exists
    if (!fs.existsSync(packagesDir)) {
      console.error('Packages directory not found!')
      process.exit(1)
    }

    // Get all submodules in packages directory, excluding current package
    const submodules = fs.readdirSync(packagesDir)
      .map(name => path.join(packagesDir, name))
      .filter(dir => fs.statSync(dir).isDirectory())

    // Process all submodules in parallel
    console.log('\nProcessing submodules in parallel...')
    await Promise.all(submodules.map(async (submodule) => {
      await processSubmodule(submodule)
      process.chdir(rootDir) // Return to root directory after each submodule
    }))

    console.log('\nAll submodules processed successfully!')

    // Now process the main repository to track submodule updates
    await processRepository(rootDir, false)

  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main();