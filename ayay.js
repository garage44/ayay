#!/usr/bin/env node
import path from 'path'
import fs from 'fs'
import os from 'os'
import simpleGit from 'simple-git'
import pc from 'picocolors' // Add picocolors for colored output

// Icons for important messages
const icons = {
  success: '✓',
  error: '✗',
  important: '▶',
  final: '✨',
  commit: '📝',  // Added icon for commit messages
  push: '🚀'     // Added icon for push operations
}

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
              model: 'claude-3-7-sonnet-latest',
              max_tokens: 3000,
              messages: [{
                role: 'user',
                content: `Generate a git commit message in conventional commits format for these changes.
Format:
- Title: One line, under 50 chars, conventional commit type (feat, fix, chore, etc.)
- Body: Detailed explanation of what changed and why, wrapped at 72 chars
- No AI-related text or explanations in the response

${diff}`
              }]
          })
      })

      if (!response.ok) {
          throw new Error(`api request failed with status ${response.status}`);
      }

      const data = await response.json()
      const message = data.content[0].text.trim()
      console.log(`${icons.commit} ${pc.bold(`commit message: ${pc.cyan(message)}`)}`)
      return message
  } catch (error) {
      console.error(`${icons.error} ${pc.red('error generating commit message:')} ${error.message}`);
      return 'chore: update submodule changes'
  }
}

async function processRepository(repoPath, isSubmodule = false) {
  try {
      const repoType = isSubmodule ? 'submodule' : 'repository'
      const repoName = path.basename(repoPath)
      console.log(`\n${icons.important} ${pc.bold(`processing ${repoType}: ${repoName}`)}`);

      // Initialize simple-git with configuration options
      const git = simpleGit({
        baseDir: repoPath,
        ...gitConfig,
      })

      // For main repository, update submodule references
      if (!isSubmodule) {
          console.log(pc.dim(' - updating submodule references...'))

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

          // Process each submodule in parallel
          if (submoduleList.length > 0) {
            console.log(pc.dim(` - found ${submoduleList.length} submodules to update`))

            // Process all submodules in parallel using Promise.all
            await Promise.all(submoduleList.map(async (submodulePath) => {
              try {
                const subName = path.basename(submodulePath)
                // Create git instance with path - no need to change directory
                const submoduleGit = simpleGit({baseDir: path.join(repoPath, submodulePath), ...gitConfig})

                // Checkout main and pull changes
                await submoduleGit.checkout('main')
                await submoduleGit.pull('origin', 'main')
                console.log(` ${icons.success} ${pc.dim(`submodule updated successfully: ${subName} `)}`)
              } catch (submoduleError) {
                console.error(`${icons.error} ${pc.red(`error updating submodule ${path.basename(submodulePath)}:`)} ${submoduleError.message}`)
              }
            }));
          } else {
            console.log(pc.dim('no submodules found to update'))
          }
      }

      // Check if there are any changes
      const status = await git.status()
      if (status.isClean()) {
          console.log(pc.dim(`- no changes in ${repoType} ${repoName}`))
          return
      }

      // Get the diff for commit message generation
      const diff = await git.diff()

      // Get files that have been changed
      const summary = await git.diffSummary()
      console.log(pc.dim(`changes detected in ${summary.files.length} files`))

      // Stage all changes
      await git.add('.')
      console.log(pc.dim('all changes staged for commit'))

      // Generate commit message using Anthropic
      const commitMessage = await generateCommitMessage(diff)

      // Create commit with better error handling
      try {
          console.log(`${pc.dim(`committing in ${repoName}...`)}`)
          await git.commit(commitMessage)
      } catch (commitError) {
          console.error(`${icons.error} ${pc.red('git commit failed:')} ${commitError.message}`)
          throw commitError
      }

      // Push changes to remote
      console.log(`${icons.push} ${pc.bold(`pushing changes to remote...`)}`)
      await git.push('origin', 'main')
  } catch (error) {
      console.error(`${icons.error} ${pc.red(`error processing ${isSubmodule ? 'submodule' : 'repository'} ${path.basename(repoPath)}:`)} ${error.message}`)
  }
}

async function processSubmodule(submodulePath) {
  try {
      const subName = path.basename(submodulePath)
      console.log(`${icons.important} ${pc.bold(`processing submodule: ${subName}`)}`);

      // Create git instance with path - no need to change directory
      const git = simpleGit({baseDir: submodulePath, ...gitConfig})

      // Check if there are any changes
      const status = await git.status()
      if (status.isClean()) {
          console.log(pc.dim(` - no changes in submodule: ${subName}`))
          return
      }

      // Get the diff for commit message generation
      const diff = await git.diff()

      // Show changed files
      const summary = await git.diffSummary()
      console.log(pc.dim(` - changes in submodule: ${subName} (${summary.files.length} files)`))
      summary.files.slice(0, 5).forEach(file => {
          console.log(pc.dim(`    • ${file.file} (${file.insertions}+ ${file.deletions}-)`))
      })
      if (summary.files.length > 5) {
          console.log(pc.dim(`    • ...and ${summary.files.length - 5} more files`));
      }

      // Stage all changes
      await git.add('.')

      // Generate commit message using Anthropic
      const commitMessage = await generateCommitMessage(diff)
      // Create commit with better error handling
      try {
          await git.commit(commitMessage)
          console.log(`${pc.dim(` - created commit in ${subName}...`)}`)
      } catch (commitError) {
          console.error(`${icons.error} ${pc.red(`git commit failed in ${subName}:`)} ${commitError.message}`)
          throw commitError
      }

      // Push changes to remote
      console.log(`${icons.push} ${pc.bold(`pushing changes to remote...`)}`)
      await git.push('origin', 'main')
      console.log(`${icons.success} ${pc.bold(pc.green(`changes in ${subName} committed and pushed successfully`))}`)
  } catch (error) {
      console.error(`${icons.error} ${pc.red(`error processing submodule ${path.basename(submodulePath)}:`)} ${error.message}`)
  }
}

async function main() {
  try {
    console.log(`\n${icons.final} ${pc.bold(pc.green('ayay, let\'s get started...'))}`)

    // Get the root directory
    const rootDir = process.cwd()
    const packagesDir = path.join(rootDir, 'packages')

    // Check if packages directory exists
    if (!fs.existsSync(packagesDir)) {
        console.error(`${icons.error} ${pc.red('packages directory not found!')}`)
        process.exit(1)
    }

    // Get all submodules in packages directory, excluding current package
    const submodules = fs.readdirSync(packagesDir)
      .map(name => path.join(packagesDir, name))
      .filter(dir => fs.statSync(dir).isDirectory())

    // Execute all submodule operations completely in parallel
    await Promise.all(submodules.map(submodule => processSubmodule(submodule)))
    // Now process the main repository to track submodule updates
    await processRepository(rootDir, false)

    console.log(`\n${icons.final} ${pc.bold(pc.green('ayay, we\'re all set!'))}`);
  } catch (error) {
    console.error(`\n${icons.error} ${pc.bold(pc.red('Error:'))} ${error.message}`)
    process.exit(1)
  }
}

main();