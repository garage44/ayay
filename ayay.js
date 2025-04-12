#!/usr/bin/env node
import path from 'path'
import fs from 'fs'
import os from 'os'
import simpleGit from 'simple-git'

// Common git configuration options
const gitConfig = {
  binary: 'git',
  maxConcurrentProcesses: 6,
}

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

      // Initialize simple-git with configuration options
      const git = simpleGit({
        baseDir: repoPath,
        ...gitConfig,
      })

      // For main repository, update submodule references
      if (!isSubmodule) {
          console.log('Updating submodule references...')

          // Get list of submodules
          const submoduleResult = await git.raw(['submodule', 'status'])
          const submoduleList = submoduleResult
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              // Extract submodule path from status line
              const match = line.trim().match(/^\S+\s+(\S+)/)
              return match ? match[1] : null
            })
            .filter(Boolean)

          // Process each submodule individually
          if (submoduleList.length > 0) {
            console.log(`Found ${submoduleList.length} submodules to update`)

            for (const submodulePath of submoduleList) {
              try {
                console.log(`Updating submodule: ${submodulePath}`)

                // Move into the submodule directory
                const originalDir = process.cwd()
                process.chdir(path.join(repoPath, submodulePath))

                // Initialize simple-git with configuration options
                const submoduleGit = simpleGit({
                  baseDir: path.join(repoPath, submodulePath),
                  ...gitConfig,
                })

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

    // Create git instance with path - no need to change directory
    const git = simpleGit({
      baseDir: submodulePath,
      ...gitConfig,
    })

    // Check if there are any changes
    const status = await git.status()
    if (status.isClean()) {
        console.log(`No changes in submodule: ${submodulePath}`);
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
      console.log(`Committing changes in ${submodulePath}: "${commitMessage}"`)
      await git.commit(commitMessage)
    } catch (commitError) {
      console.error(`Git commit failed in ${submodulePath}:`, commitError.message)
      throw commitError
    }

    // Push changes to remote
    await git.push('origin', 'main')
    console.log(`Successfully committed and pushed changes in ${submodulePath}`)
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
    console.log(`\nProcessing ${submodules.length} submodules in parallel...`)

    // Execute all submodule operations completely in parallel
    await Promise.all(
      submodules.map(submodule => processSubmodule(submodule))
    );

    console.log('\nAll submodules processed in parallel successfully!')

    // Now process the main repository to track submodule updates
    await processRepository(rootDir, false)

  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main();