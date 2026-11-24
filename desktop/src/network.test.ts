import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandPaths, NETWORK_TIMEOUT_MS, normaliseMac, readNetwork, wifiDevice, type Run } from './network';

const HARDWARE_PORTS = (wifi: string) => `
Hardware Port: Ethernet Adapter (en4)
Device: en4
Ethernet Address: 11:22:33:44:55:66

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: N/A

Hardware Port: Wi-Fi
Device: ${wifi}
Ethernet Address: aa:bb:cc:dd:ee:ff

VLAN Configurations
===================
`;

// The owner's Mac, behind a proxy in TUN mode (hence -ifscope).
const ROUTE_OK = `   route to: default
destination: default
       mask: default
    gateway: 10.0.160.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,IFSCOPE>
 recvpipe  sendpipe  ssthresh  rtt,msec    rttvar  hopcount      mtu     expire
       0         0         0         0         0         0      1500         0
`;
const ARP_OK = '? (10.0.160.1) at 80:5:88:d0:83:e2 on en0 ifscope [ethernet]\n';

type Answer = string | (() => Promise<string>);
/**
 * A stand-in for the commands: answers by command name; a function answer may throw; a list answers
 * call by call (its last entry from then on). A command without an answer fails.
 */
function fakeRun(answers: Partial<Record<'networksetup' | 'route' | 'arp' | 'ping', Answer | Answer[]>>) {
  const calls: Array<[string, string[]]> = [];
  const seen: Record<string, number> = {};
  const run: Run = async (cmd, args) => {
    calls.push([cmd, args]);
    const name = cmd.split('/').pop() as keyof typeof answers;
    const given = answers[name];
    if (given === undefined) throw new Error(`unexpected ${cmd}`);
    const i = (seen[name] = (seen[name] ?? -1) + 1);
    const a = Array.isArray(given) ? given[Math.min(i, given.length - 1)] : given;
    return typeof a === 'string' ? a : a();
  };
  return { run, calls };
}

const failing = (stderr: string) => async () => {
  throw Object.assign(new Error('Command failed'), { code: 1, stderr });
};

describe('normaliseMac', () => {
  it('pads, lowercases and keeps six colon-separated octets', () => {
    expect(normaliseMac('80:5:88:d0:83:E2')).toBe('80:05:88:d0:83:e2');
    expect(normaliseMac('80:05:88:D0:83:E2')).toBe('80:05:88:d0:83:e2');
    expect(normaliseMac('0:0:0:0:0:1')).toBe('00:00:00:00:00:01');
    expect(normaliseMac(' 80:05:88:d0:83:e2 ')).toBe('80:05:88:d0:83:e2');
  });

  it('refuses anything else', () => {
    for (const s of ['', '80-05-88-d0-83-e2', '80:05:88:d0:83', '80:05:88:d0:83:e2:01', '800:5:88:d0:83:e2', '80:05:88:d0:83:g2', '(incomplete)', '80::88:d0:83:e2', 'x']) {
      expect(normaliseMac(s), s).toBeNull();
    }
  });
});

describe('wifiDevice', () => {
  it('takes the Device after "Hardware Port: Wi-Fi"', async () => {
    expect(await wifiDevice(fakeRun({ networksetup: HARDWARE_PORTS('en0') }).run)).toBe('en0');
    expect(await wifiDevice(fakeRun({ networksetup: HARDWARE_PORTS('en1') }).run)).toBe('en1');
  });

  it('runs networksetup -listallhardwareports', async () => {
    const { run, calls } = fakeRun({ networksetup: HARDWARE_PORTS('en0') });
    await wifiDevice(run);
    expect(calls).toEqual([['/usr/sbin/networksetup', ['-listallhardwareports']]]);
  });

  it('is null on a Mac without Wi-Fi', async () => {
    expect(await wifiDevice(fakeRun({ networksetup: 'Hardware Port: Ethernet\nDevice: en0\nEthernet Address: x\n' }).run)).toBeNull();
    expect(await wifiDevice(fakeRun({ networksetup: '' }).run)).toBeNull();
  });
});

describe('readNetwork', () => {
  afterEach(() => vi.useRealTimers());

  it("reads the Wi-Fi router's MAC (the owner's sample)", async () => {
    const { run, calls } = fakeRun({ networksetup: HARDWARE_PORTS('en0'), route: ROUTE_OK, arp: ARP_OK });
    expect(await readNetwork(run)).toEqual({ kind: 'network', mac: '80:05:88:d0:83:e2' });
    expect(calls).toEqual([
      ['/usr/sbin/networksetup', ['-listallhardwareports']],
      ['/sbin/route', ['-n', 'get', '-ifscope', 'en0', 'default']],
      ['/usr/sbin/arp', ['-n', '10.0.160.1']],
    ]);
  });

  it('asks about the Wi-Fi device it found', async () => {
    const { run, calls } = fakeRun({
      networksetup: HARDWARE_PORTS('en1'),
      route: ROUTE_OK.replace('en0', 'en1'),
      arp: '? (10.0.160.1) at 80:5:88:d0:83:e2 on en1 ifscope [ethernet]\n',
    });
    expect(await readNetwork(run)).toEqual({ kind: 'network', mac: '80:05:88:d0:83:e2' });
    expect(calls[1]).toEqual(['/sbin/route', ['-n', 'get', '-ifscope', 'en1', 'default']]);
  });

  it('is none without a Wi-Fi device, or without a gateway on it', async () => {
    expect(await readNetwork(fakeRun({ networksetup: 'Hardware Port: Ethernet\nDevice: en0\n' }).run)).toEqual({ kind: 'none' });
    const noGateway = '   route to: default\ndestination: default\n  interface: en0\n';
    expect(await readNetwork(fakeRun({ networksetup: HARDWARE_PORTS('en0'), route: noGateway }).run)).toEqual({ kind: 'none' });
    // Wi-Fi off or not joined: route fails with "not in table".
    const notInTable = failing('route: writing to routing socket: not in table\n');
    expect(await readNetwork(fakeRun({ networksetup: HARDWARE_PORTS('en0'), route: notInTable }).run)).toEqual({ kind: 'none' });
  });

  it('is unknown when the MAC cannot be read', async () => {
    const base = { networksetup: HARDWARE_PORTS('en0'), route: ROUTE_OK };
    for (const arp of [
      '? (10.0.160.1) at (incomplete) on en0 ifscope [ethernet]\n',
      '10.0.160.1 (10.0.160.1) -- no entry\n',
      '? (10.0.160.1) at 80:5:88:d0:83:e2 on en7 ifscope [ethernet]\n', // another interface's entry
      '',
      'garbage',
    ]) {
      expect(await readNetwork(fakeRun({ ...base, arp }).run), arp).toEqual({ kind: 'unknown' });
    }
    expect(await readNetwork(fakeRun({ ...base, arp: failing('arp: bad') }).run)).toEqual({ kind: 'unknown' });
  });

  describe('an aged-out ARP entry (macOS drops it after ~20 min idle)', () => {
    const base = { networksetup: HARDWARE_PORTS('en0'), route: ROUTE_OK };
    const PING = ['/sbin/ping', ['-n', '-q', '-c', '1', '-t', '1', '-b', 'en0', '10.0.160.1']];

    it('pings the router once over the Wi-Fi, then reads arp again: no entry → ping → MAC is the network', async () => {
      const noEntry = failing('10.0.160.1 (10.0.160.1) -- no entry\n');
      const { run, calls } = fakeRun({ ...base, arp: [noEntry, ARP_OK], ping: '1 packets transmitted, 1 packets received\n' });
      expect(await readNetwork(run)).toEqual({ kind: 'network', mac: '80:05:88:d0:83:e2' });
      expect(calls.slice(2)).toEqual([['/usr/sbin/arp', ['-n', '10.0.160.1']], PING, ['/usr/sbin/arp', ['-n', '10.0.160.1']]]);
    });

    it('also after an (incomplete) entry or no matching line', async () => {
      for (const first of ['? (10.0.160.1) at (incomplete) on en0 ifscope [ethernet]\n', '']) {
        const { run, calls } = fakeRun({ ...base, arp: [first, ARP_OK], ping: '' });
        expect(await readNetwork(run), first).toEqual({ kind: 'network', mac: '80:05:88:d0:83:e2' });
        expect(calls.filter(([c]) => c === '/sbin/ping')).toEqual([PING]);
      }
    });

    it('is unknown when the ping fails and arp still has no MAC (never an older reading)', async () => {
      const noEntry = failing('10.0.160.1 (10.0.160.1) -- no entry\n');
      const { run, calls } = fakeRun({ ...base, arp: noEntry, ping: failing('100.0% packet loss') });
      expect(await readNetwork(run)).toEqual({ kind: 'unknown' });
      expect(calls.filter(([c]) => c === '/usr/sbin/arp')).toHaveLength(2); // one retry only
      expect(calls.filter(([c]) => c === '/sbin/ping')).toHaveLength(1);
    });

    it('a ping that succeeds does not help an arp that stays (incomplete)', async () => {
      const incomplete = '? (10.0.160.1) at (incomplete) on en0 ifscope [ethernet]\n';
      expect(await readNetwork(fakeRun({ ...base, arp: incomplete, ping: '' }).run)).toEqual({ kind: 'unknown' });
    });

    it('never pings when the first arp has the MAC', async () => {
      const { run, calls } = fakeRun({ ...base, arp: ARP_OK, ping: '' });
      expect(await readNetwork(run)).toEqual({ kind: 'network', mac: '80:05:88:d0:83:e2' });
      expect(calls.some(([c]) => c === '/sbin/ping')).toBe(false);
    });

    it('pings on the Wi-Fi device it found', async () => {
      const { run, calls } = fakeRun({
        networksetup: HARDWARE_PORTS('en1'),
        route: ROUTE_OK.replace('en0', 'en1'),
        arp: ['', '? (10.0.160.1) at 80:5:88:d0:83:e2 on en1 ifscope [ethernet]\n'],
        ping: '',
      });
      expect(await readNetwork(run)).toEqual({ kind: 'network', mac: '80:05:88:d0:83:e2' });
      expect(calls.find(([c]) => c === '/sbin/ping')?.[1]).toEqual(['-n', '-q', '-c', '1', '-t', '1', '-b', 'en1', '10.0.160.1']);
    });
  });

  it('is unknown on any other failure, or a gateway that is not an address', async () => {
    expect(await readNetwork(fakeRun({ networksetup: failing('boom') }).run)).toEqual({ kind: 'unknown' });
    expect(await readNetwork(fakeRun({ networksetup: HARDWARE_PORTS('en0'), route: failing('route: permission denied') }).run)).toEqual({
      kind: 'unknown',
    });
    expect(await readNetwork(fakeRun({ networksetup: HARDWARE_PORTS('en0'), route: ROUTE_OK.replace('10.0.160.1', 'link#6') }).run)).toEqual({
      kind: 'unknown',
    });
  });

  it('gives up after 3 s in all (room for one ping of the router)', async () => {
    vi.useFakeTimers();
    expect(NETWORK_TIMEOUT_MS).toBe(3_000);
    const read = readNetwork(fakeRun({ networksetup: HARDWARE_PORTS('en0'), route: () => new Promise<string>(() => undefined) }).run);
    await vi.advanceTimersByTimeAsync(2_999);
    let settled = false;
    void read.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).resolves.toEqual({ kind: 'unknown' });
  });
});

describe('commandPaths', () => {
  it('is the system commands once packaged, whatever the environment says', () => {
    expect(commandPaths({ packaged: true, env: { YUNGU_NETWORK_COMMANDS: '/tmp/fake' } })).toEqual({
      networksetup: '/usr/sbin/networksetup',
      route: '/sbin/route',
      arp: '/usr/sbin/arp',
      ping: '/sbin/ping',
    });
  });

  it('takes stand-ins from YUNGU_NETWORK_COMMANDS in development', () => {
    expect(commandPaths({ packaged: false, env: { YUNGU_NETWORK_COMMANDS: '/tmp/fake' } })).toEqual({
      networksetup: '/tmp/fake/networksetup',
      route: '/tmp/fake/route',
      arp: '/tmp/fake/arp',
      ping: '/tmp/fake/ping',
    });
    expect(commandPaths({ packaged: false, env: {} }).route).toBe('/sbin/route');
  });
});
