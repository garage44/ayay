#!/usr/bin/env node
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Try to load environment variables from multiple locations
const envFiles = [
  path.join(process.cwd(), '.workspace-commit'),
  path.join(os.homedir(), '.workspace-commit')
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

      // Check if there are any changes
      const status = execSync('git status --porcelain').toString()
      if (!status) {
          console.log(`No changes in this ${repoType}`);
          return
      }

      // Get the diff for commit message generation
      const diff = execSync('git diff').toString()
      // Stage all changes
      execSync('git add -A')
      // Generate commit message using Anthropic
      const commitMessage = await generateCommitMessage(diff)
      // Create commit
      execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' })
      console.log(`Successfully committed changes in ${repoType}`)
  } catch (error) {
      console.error(`Error processing ${isSubmodule ? 'submodule' : 'repository'} ${repoPath}:`, error)
  }
}


async function processSubmodule(submodulePath) {
  try {
    console.log(`\nProcessing submodule: ${submodulePath}`)
    // Change to submodule directory
    process.chdir(submodulePath)

    // Check if there are any changes
    const status = execSync('git status --porcelain').toString();
    if (!status) {
        console.log('No changes in this submodule');
        return
    }

    // Get the diff for commit message generation
    const diff = execSync('git diff').toString()
    // Stage all changes
    execSync('git add -A')
    // Generate commit message using Anthropic
    const commitMessage = await generateCommitMessage(diff)
    // Create commit
    execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' })
    console.log('Successfully committed changes')

  } catch (error) {
    console.error(`Error processing submodule ${submodulePath}:`, error)
  }
}

async function main() {
  try {
    // Get the root directory
    const rootDir = process.cwd()
    const packagesDir = path.join(rootDir, 'packages')

    // First process the main repository
    await processRepository(rootDir, false)

    // Check if packages directory exists
    if (!fs.existsSync(packagesDir)) {
      console.error('Packages directory not found!')
      process.exit(1)
    }

    // Get all submodules in packages directory
    const submodules = fs.readdirSync(packagesDir)
      .map(name => path.join(packagesDir, name))
      .filter(dir => fs.statSync(dir).isDirectory())

    // Process each submodule
    for (const submodule of submodules) {
      await processSubmodule(submodule)
      process.chdir(rootDir) // Return to root directory
    }

    console.log('\nAll submodules processed successfully!')

  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main();