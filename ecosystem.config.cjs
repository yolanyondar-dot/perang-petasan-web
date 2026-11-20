module.exports = {
  apps: [
    {
      name: 'perang-petasan-server',
      script: './server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 2567,
        HOST: '127.0.0.1',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 2567,
        HOST: '127.0.0.1',
      },
    },
  ],
};
