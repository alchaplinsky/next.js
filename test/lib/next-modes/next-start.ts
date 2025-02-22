import path from 'path'
import fs from 'fs-extra'
import { NextInstance } from './base'
import { spawn, SpawnOptions } from 'child_process'

export class NextStartInstance extends NextInstance {
  private _buildId: string
  private _cliOutput: string

  public get buildId() {
    return this._buildId
  }

  public get cliOutput() {
    return this._cliOutput
  }

  public async setup() {
    await super.createTestDir()
  }

  public async start() {
    if (this.childProcess) {
      throw new Error('next already started')
    }
    const spawnOpts: SpawnOptions = {
      cwd: this.testDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        NODE_ENV: '' as any,
        __NEXT_TEST_MODE: '1',
        __NEXT_RAND_PORT: '1',
      },
    }
    const handleStdio = () => {
      this.childProcess.stdout.on('data', (chunk) => {
        const msg = chunk.toString()
        process.stdout.write(chunk)
        this._cliOutput += msg
        this.emit('stdout', [msg])
      })
      this.childProcess.stderr.on('data', (chunk) => {
        const msg = chunk.toString()
        process.stderr.write(chunk)
        this._cliOutput += msg
        this.emit('stderr', [msg])
      })
    }
    let buildArgs = ['yarn', 'next', 'build']
    let startArgs = ['yarn', 'next', 'start']

    if (this.buildCommand) {
      buildArgs = this.buildCommand.split(' ')
    }
    if (this.startCommand) {
      startArgs = this.startCommand.split(' ')
    }

    await new Promise<void>((resolve, reject) => {
      console.log('running', buildArgs.join(' '))
      this.childProcess = spawn(buildArgs[0], buildArgs.slice(1), spawnOpts)
      handleStdio()
      this.childProcess.on('exit', (code, signal) => {
        if (code || signal)
          reject(
            new Error(`next build failed with code/signal ${code || signal}`)
          )
        else resolve()
      })
    })

    this._buildId = (
      await fs.readFile(
        path.join(
          this.testDir,
          this.nextConfig?.distDir || '.next',
          'BUILD_ID'
        ),
        'utf8'
      )
    ).trim()

    console.log('running', startArgs.join(' '))

    await new Promise<void>((resolve) => {
      this.childProcess = spawn(startArgs[0], startArgs.slice(1), spawnOpts)
      handleStdio()

      this.childProcess.on('close', (code, signal) => {
        if (this.isStopping) return
        if (code || signal) {
          throw new Error(
            `next start exited unexpectedly with code/signal ${code || signal}`
          )
        }
      })

      const readyCb = (msg) => {
        if (msg.includes('started server on') && msg.includes('url:')) {
          this._url = msg.split('url: ').pop().trim()
          this._parsedUrl = new URL(this._url)
          this.off('stdout', readyCb)
          resolve()
        }
      }
      this.on('stdout', readyCb)
    })
  }
}
