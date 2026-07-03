const { execSync } = require('child_process');

function main() {
  const myPid = process.pid;
  const parentPid = process.ppid;
  console.log(`My PID: ${myPid}, Parent PID: ${parentPid}`);

  try {
    let output = '';
    if (process.platform === 'win32') {
      output = execSync('wmic process where name="node.exe" get processid,parentprocessid,commandline').toString();
    } else {
      output = execSync('ps -ef | grep node').toString();
    }

    const lines = output.split('\n');
    console.log(`Found ${lines.length - 2} potential node processes.`);

    lines.forEach(line => {
      if (!line.trim()) return;
      const match = line.match(/(\d+)\s+(\d+)/) || line.match(/node\.exe\s+(\d+)\s+(\d+)/);
      // Let's parse PID from wmic output
      // wmic output format is: CommandLine  ParentProcessId  ProcessId
      const parts = line.trim().split(/\s+/);
      const pidStr = parts[parts.length - 1];
      const ppidStr = parts[parts.length - 2];
      
      const pid = parseInt(pidStr, 10);
      const ppid = parseInt(ppidStr, 10);

      if (isNaN(pid)) return;
      if (pid === myPid || pid === parentPid) {
        console.log(`Keeping our own process: ${pid}`);
        return;
      }

      // Check if it's the wmic command or something else
      if (line.includes('kill_orphans.js')) return;

      console.log(`Killing node process ${pid} (Parent: ${ppid})...`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        console.error(`Failed to kill ${pid}:`, err.message);
      }
    });

  } catch (err) {
    console.error('Error listing/killing processes:', err.message);
  }
}

main();
