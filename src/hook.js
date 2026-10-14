// Runs the --on-renew command after a new certificate has been written, so the app using it can reload.
// The command comes from the operator's own flags or environment, so it is run through the shell as typed.

const { spawn } = require('child_process');

// Resolves to the exit code (null if the command could not start); never rejects
function runHook(command, { dir, keyFile, certFile, domains }, log = () => {}) {
    return new Promise(resolve => {
        log(`Running on-renew command: ${command}`);
        const child = spawn(command, {
            shell: true,
            stdio: 'inherit',
            env: { ...process.env, CERT_DIR: dir, KEY_PATH: keyFile, CERT_PATH: certFile, CERT_DOMAINS: domains.join(',') },
        });
        child.on('error', error => {
            log(`on-renew command could not start: ${error.message}`);
            resolve(null);
        });
        child.on('exit', code => {
            if (code !== 0) log(`on-renew command exited with code ${code}`);
            resolve(code);
        });
    });
}

module.exports = { runHook };
