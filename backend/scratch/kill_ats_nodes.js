const { execSync } = require('child_process');

function main() {
  try {
    const output = execSync('powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = \'node.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"').toString().trim();
    if (!output) {
      console.log('No node processes found.');
      return;
    }

    const processes = JSON.parse(output);
    const processList = Array.isArray(processes) ? processes : [processes];
    console.log(`Checking ${processList.length} node processes...`);

    const myPid = process.pid;

    processList.forEach(p => {
      const pid = p.ProcessId;
      const cmd = p.CommandLine || '';

      if (pid === myPid) return;

      // Check if this is an ATS-BP dev server or index script
      const isAtsProcess = cmd.includes('ATS-BP') || cmd.includes('addIndexes') || cmd.includes('index.js') || cmd.includes('test_perf_audit');
      // Ensure we DO NOT kill the agent itself
      const isAgentProcess = cmd.includes('antigravity') || cmd.includes('.gemini');

      if (isAtsProcess && !isAgentProcess) {
        console.log(`Killing ATS Node Process PID: ${pid} | Cmd: ${cmd}`);
        try {
          process.kill(pid, 'SIGKILL');
        } catch (err) {
          console.error(`Failed to kill PID ${pid}:`, err.message);
        }
      } else {
        console.log(`Keeping Node Process PID: ${pid} | Cmd: ${cmd}`);
      }
    });

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
