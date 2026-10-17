// Draws preview.png, the picture WhatsApp/Discord show when someone shares the site link.
// Run from the project folder:  java tools/MakePreviewImage.java
import java.awt.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class MakePreviewImage {
    static final int WIDTH = 1200, HEIGHT = 630; // the size link previews expect
    static final Color BACKGROUND = new Color(0x302e2b);
    static final Color WOOD = new Color(0xdcb35c);
    static final Color LINE = new Color(0x3b2a14);
    static final Color TEXT = new Color(0xe8e6e3);
    static final Color TEXT_DIM = new Color(0xa09d99);
    static final Color ACCENT = new Color(0x81b64c);

    public static void main(String[] args) throws Exception {
        BufferedImage image = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setColor(BACKGROUND);
        g.fillRect(0, 0, WIDTH, HEIGHT);

        drawLogo(g, 80, 85, 460);
        drawText(g, 630);

        g.dispose();
        ImageIO.write(image, "png", new File("preview.png"));
        System.out.println("Wrote preview.png");
    }

    // The GoBoard logo (same shapes as img/logo.svg, which is 34 units wide): a round
    // wooden board with two lines each way, a black stone and a white stone.
    static void drawLogo(Graphics2D g, int left, int top, int size) {
        double u = size / 34.0;
        fillCircle(g, left + 17 * u, top + 17 * u, 17 * u, WOOD);
        g.setColor(LINE);
        g.setStroke(new BasicStroke((float) (1.4 * u)));
        double[][] lines = {{4, 11, 30, 11}, {2, 23, 32, 23}, {11, 4, 11, 30}, {23, 2, 23, 32}};
        for (double[] l : lines) {
            g.draw(new Line2D.Double(left + l[0] * u, top + l[1] * u, left + l[2] * u, top + l[3] * u));
        }
        drawStone(g, left + 11 * u, top + 11 * u, 6.5 * u, true);
        drawStone(g, left + 23 * u, top + 23 * u, 6.5 * u, false);
    }

    static void drawStone(Graphics2D g, double cx, double cy, double r, boolean black) {
        Color[] colors = black
            ? new Color[] {new Color(0x5a5a5a), new Color(0x050505)}
            : new Color[] {Color.WHITE, new Color(0xc8c8c8)};
        Point2D focus = new Point2D.Double(cx - r * 0.3, cy - r * 0.3);
        g.setPaint(new RadialGradientPaint(focus, (float) (r * 1.4), new float[] {0f, 1f}, colors));
        g.fill(new Ellipse2D.Double(cx - r, cy - r, 2 * r, 2 * r));
    }

    static void fillCircle(Graphics2D g, double cx, double cy, double r, Color color) {
        g.setColor(color);
        g.fill(new Ellipse2D.Double(cx - r, cy - r, 2 * r, 2 * r));
    }

    static void drawText(Graphics2D g, int left) {
        g.setColor(TEXT);
        g.setFont(new Font("SansSerif", Font.BOLD, 96));
        g.drawString("GoBoard", left, 245);

        g.setColor(ACCENT);
        g.fillRoundRect(left, 280, 120, 10, 10, 10);

        g.setColor(TEXT);
        g.setFont(new Font("SansSerif", Font.BOLD, 40));
        g.drawString("Play Go free in", left, 360);
        g.drawString("your browser", left, 410);

        g.setColor(TEXT_DIM);
        g.setFont(new Font("SansSerif", Font.PLAIN, 28));
        g.drawString("Friends  ·  5 bots  ·  Online  ·  Puzzles", left, 480);
    }
}
