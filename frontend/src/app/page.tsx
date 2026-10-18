import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

export default function Home() {
  return (
    <Container maxWidth="sm">
      <Stack spacing={3} sx={{ minHeight: "100vh", justifyContent: "center" }}>
        <Typography variant="h3" component="h1">
          Next.js + MUI
        </Typography>
        <Typography color="text.secondary">
          Material UI is installed and wired into the App Router. Edit
          src/app/page.tsx to get started.
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button variant="contained" startIcon={<RocketLaunchIcon />}>
            Contained
          </Button>
          <Button variant="outlined">Outlined</Button>
        </Stack>
      </Stack>
    </Container>
  );
}
